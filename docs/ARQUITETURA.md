# Organiza: arquitetura do MVP

Prioridade: **simplicidade → experiência do usuário → IA → escalabilidade → monetização.**

A experiência que queremos entregar é esta:

> "Eu não preciso ficar organizando minha vida. Eu simplesmente falo com a Nina e ela organiza para mim."

---

## 1. Arquitetura

O Organiza é um único app **Next.js** (App Router). Ele faz o frontend e o backend juntos, então há um só deploy e um só lugar para manter. Esse app roda sem estado em memória, o que permite subir várias cópias atrás de um balanceador quando o número de usuários crescer. O estado todo fica no PostgreSQL.

```
┌────────────────────────── Navegador (mobile first) ──────────────────────────┐
│  Início · Nina (chat) · Agenda · Dinheiro · Compras · Conta                  │
│  🎙️ voz: SpeechRecognition do navegador  ─┐  (ou gravação → /api/transcribe) │
└────────────────────────────────────────────┼─────────────────────────────────┘
                                             ▼
┌──────────────────────────────── Next.js (Node) ──────────────────────────────┐
│ middleware (Auth.js)  → bloqueia tudo que não é login/cadastro               │
│                                                                              │
│ /api/chat ─► lib/nina/index.ts (orquestrador)                                │
│               1. limite do plano (usage_counters)                            │
│               2. salva a mensagem do usuário                                 │
│               3. contexto do usuário (context.ts)  ◄── só dados deste userId │
│               4. Claude + ferramenta "organizar"  (llm.ts)                   │
│                  └─ sem chave/erro → interpretador por regras (fallback.ts)  │
│               5. validação de cada intenção (actions.ts, zod)                │
│               6. filtro por plano (plans.ts)                                 │
│               7. executor em transação, escopo userId (executor.ts)          │
│               8. salva a resposta + cartões + sugestão · conta a interação   │
│                                                                              │
│ Server actions (actions/items.ts) → marcar, apagar, adiar, pagar…            │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      ▼
                           PostgreSQL (Drizzle ORM)
```

Há duas decisões que valem registrar.

**A IA não toca no banco.** Ela devolve intenções num formato fixo, e essas intenções passam por validação antes de virar escrita. Isso protege contra respostas inesperadas do modelo e contra tentativas de injeção de instruções. Também permite trocar de modelo, ou mesmo de fornecedor, sem mexer no resto do sistema.

**O modo simples funciona sem chave de IA.** Um interpretador por regras cobre os pedidos mais comuns. Assim dá para desenvolver e testar de graça, e o produto continua funcionando se a API de IA cair.

## 2. Estrutura de pastas

| Pasta | Conteúdo |
|---|---|
| `src/app/(auth)` | Login e cadastro, públicos |
| `src/app/onboarding` | As 4 telas iniciais |
| `src/app/(app)` | Área logada (o layout checa a sessão e o onboarding) |
| `src/app/api` | Rotas `chat`, `chat/suggestion`, `transcribe`, `register` e `auth` |
| `src/lib/nina` | Prompt, contexto, intenções, LLM, regras, executor e orquestrador |
| `src/lib/data` | Consultas reutilizáveis, alertas e contas recorrentes |
| `src/lib` | Datas no fuso do usuário, dinheiro, planos, logs, erros e limite de taxa |
| `src/actions` | Server actions da interface |
| `src/components` | Voz (`useVoice`), conversa (`useNina`), chat e navegação |
| `src/db` | Schema, conexão e migração |
| `drizzle/` | Migrações SQL versionadas |
| `tests/` | Testes de ponta a ponta com PGlite |

## 3. Banco de dados

O banco é **PostgreSQL** acessado com **Drizzle ORM**. O Drizzle foi escolhido por ser TypeScript puro, sem binários, com SQL previsível e migrações simples de ler. O schema completo está em `src/db/schema.ts`.

| Grupo | Tabelas |
|---|---|
| Usuários | `users` (inclui `plan`, `timezone` e `onboarded`), `user_preferences`, `accounts`, `sessions` e `verification_tokens` (as três últimas são do Auth.js) |
| Conversa | `conversations`, `messages` |
| Organização | `tasks`, `events`, `reminders` |
| Financeiro | `expenses`, `income`, `categories`, `recurring_items`, `subscriptions` |
| Compras | `shopping_lists`, `shopping_items` |
| Casa | `documents`, `warranties` |
| Sistema | `notifications`, `ai_memory`, `usage_counters` |

### Colunas de `messages`

Além do texto, cada mensagem guarda:
- `actions`: as intenções que foram executadas;
- `cards`: os cartões de confirmação exibidos;
- `suggestion` e `suggestionState`: a oferta com botões e se ela foi aceita ou recusada.

### Convenções

- **`user_id` em tudo.** Toda tabela de dados tem `user_id`, com índice composto e `ON DELETE CASCADE`. Apagar um usuário apaga tudo que é dele.
- **Dinheiro em centavos.** Os valores ficam em `integer`, sem erro de arredondamento.
- **Datas sem hora como `DATE`.** Os horários ficam como `"HH:MM"` no fuso do usuário. Com isso, "dentista dia 20 às 14h" continua sendo dia 20 às 14h, em qualquer servidor.
- **Recorrência.**
  - Compromissos: `events.recurrence`, `interval`, `until` e `skipDates`. As ocorrências são calculadas na leitura, então não geram linhas extras.
  - Contas mensais ("vence todo dia 10"): uma linha em `recurring_items` gera uma `expense` **PENDING** por mês. A geração acontece quando o usuário abre o app e não duplica, graças a um índice único.
- **Categorias.** As padrão têm `user_id` nulo. As personalizadas, que chegam numa fase futura, têm `user_id`.

## 4. Fluxo da IA

### Exemplo (seção 22 do briefing)

O usuário diz: "Gastei 80 reais no mercado."

**O que o modelo devolve** pela ferramenta `organizar`, com saída estruturada forçada:

```json
{
  "reply": "Registrei R$ 80 em Alimentação. ✅",
  "actions": [
    { "type": "add_transaction", "kind": "expense", "amount": 80,
      "category": "alimentacao", "description": "Mercado" }
  ],
  "suggestion": null
}
```

**A camada de intenções** (`actions.ts`) confere cada ação:
- o `type` precisa estar na lista permitida;
- a data precisa existir, e o horário precisa estar no formato HH:MM;
- o valor precisa ser positivo e ficar abaixo do teto;
- a categoria precisa ser conhecida.

Uma ação inválida é descartada sozinha, e o resto da resposta continua valendo.

**O executor** grava `expenses(amount_cents=8000, category_key='alimentacao', status='PAID', user_id=<sessão>)` e devolve o cartão "💰 R$ 80,00 · Mercado — 🍔 Alimentação · Despesa".

### O que vai para o modelo

| Parte | Conteúdo |
|---|---|
| `system` | As instruções fixas da Nina (personalidade, regras, catálogo de ações). Esse trecho vai marcado para cache da API, o que reduz o custo. |
| Histórico | As 10 últimas mensagens da conversa. |
| Contexto | Um JSON enxuto só com os dados do usuário: |
| | • hoje e os próximos 14 dias com o dia da semana, para "sexta" virar uma data certa |
| | • compromissos, tarefas, contas, lembretes e assinaturas, com os ids, para alterar e cancelar |
| | • lista de compras, memória e resumo do mês |
| | • o plano do usuário |

### Perguntas quando falta informação

Se o usuário diz "Tenho médico amanhã", o modelo devolve `actions: []` e `reply: "Qual horário do médico?"`. Quando o usuário responde "15h", o histórico permite completar o pedido.

O modo simples faz o mesmo. Ele sabe que a pergunta anterior foi sobre horário e junta as duas mensagens.

### Sugestões com botões

A sugestão "Quer que eu te lembre 1 dia antes?" é gravada **no servidor**. Nesse momento, `ref:"new:0"` já é trocado pelo id real do evento. O botão só envia `{messageId, accept}`, então o cliente não consegue executar uma ação arbitrária.

### Custo

O modelo padrão é o Claude Haiku 4.5, rápido e barato. A resposta é limitada a 1.200 tokens, e as instruções fixas ficam em cache. Para trocar de modelo, basta mudar `NINA_MODEL`.

## 5. Fluxo do usuário

1. **Cadastro** com e-mail e senha, ou com Google. O usuário recebe as estruturas básicas: preferências, lista de compras e conversa.
2. **Onboarding:** boas-vindas, nome, o que quer organizar e "basta falar comigo".
3. **Início:** "Olá, Rômulo 👋", o microfone grande, o campo de texto e exemplos que podem ser tocados.
   - O resumo do dia mostra hoje, pendências, gastos de hoje, alertas e compras.
4. **O usuário fala ou digita.**
   - A resposta da Nina aparece ali mesmo, com os cartões de confirmação e os botões.
   - A tela se atualiza sozinha.
5. **Abas:**
   - **Agenda:** próximos dias, rotinas e tarefas.
   - **Dinheiro:** mês, contas a pagar, categorias e lançamentos.
   - **Compras**.
   - **Conta:** nome, plano, uso do mês e memória da Nina.
6. **Ajustes rápidos** sem abrir formulários: marcar, adiar para amanhã, "Paguei", remover.

### Alertas

Os alertas são calculados na leitura, sem job em segundo plano no MVP. São no máximo 4 por vez, ordenados por importância:
- compromisso amanhã;
- conta que vence em até 2 dias ou já venceu;
- tarefas atrasadas;
- item parado na lista de compras há 5 dias;
- lembretes de hoje.

Cada alerta pode ser dispensado. O registro fica em `notifications.dismissed_at`.

## 6. Tecnologias

| Camada | Escolha | Por quê |
|---|---|---|
| App | Next.js 15, React 19, TypeScript | Um só projeto e um só deploy, com server components e server actions |
| Estilo | Tailwind CSS 4 e fontes empacotadas (Bricolage Grotesque, Figtree) | Rápido de manter, sem dependência externa em produção |
| Banco | PostgreSQL 16 com Drizzle ORM | Robusto e barato (Neon, Supabase, RDS), e as migrações são SQL puro |
| Autenticação | Auth.js v5 (credenciais com bcrypt e Google) | Padrão do ecossistema e fácil de estender (e-mail mágico, WhatsApp) |
| IA | Claude (Anthropic SDK) com ferramenta forçada | Extração estruturada confiável e boa compreensão de português |
| Voz | Web Speech API; `/api/transcribe` com OpenAI como alternativa | Grátis na maior parte dos celulares, com reserva no servidor |
| Validação | zod | Um só contrato para a API, as server actions e as intenções da IA |
| Testes | node:test com PGlite (Postgres em WASM) | Testes de verdade contra Postgres, sem Docker |

## 7. Segurança

- **Autenticação.**
  - Senhas com bcrypt (custo 12).
  - O login leva o mesmo tempo quando o e-mail existe e quando não existe.
  - Limites de tentativa: 10 logins por e-mail a cada 15 minutos e 5 cadastros por IP por hora.
  - A sessão é um JWT assinado (`AUTH_SECRET`) em cookie httpOnly.
- **Controle de acesso.**
  - O middleware bloqueia qualquer rota fora de login e cadastro.
  - `requireUser()` (em `lib/session.ts`) é a **única** fonte de `userId`.
- **Isolamento.**
  - Toda escrita usa `WHERE id = ? AND user_id = ?`.
  - Os testes provam que um usuário não conclui a tarefa de outro, nem responde a sugestão de outro.
- **Entrada.**
  - zod em todas as rotas e server actions.
  - Mensagens com no máximo 1.000 caracteres.
  - Áudio de até 8 MB, só nos formatos permitidos.
- **IA.**
  - Ações vêm de uma lista fechada e passam por validação estrita.
  - Ids são conferidos contra o dono.
  - Os limites do plano são aplicados no servidor.
- **Criptografia.**
  - TLS com HSTS.
  - Senhas com hash.
  - Em produção, o banco deve ter criptografia em repouso (padrão em Neon, Supabase e RDS).
  - Os segredos ficam só em variáveis de ambiente.
- **Logs.**
  - JSON estruturado.
  - O conteúdo de mensagens e as credenciais são omitidos automaticamente.
  - São registradas métricas úteis: tempo, tokens, tipos de ação e ações descartadas.
- **Erros.** Mensagens genéricas para o usuário. Os detalhes vão só para o log.

## 8. Escala (quando crescer)

- **O app** não guarda estado, então é possível subir mais instâncias. A troca necessária é o limite de taxa, que hoje fica em memória e passaria para Redis (Upstash).
- **O Postgres** usa índices compostos por `user_id`. Os próximos passos seriam um pool de conexões (PgBouncer ou Neon) e réplicas de leitura para o dashboard.
- **O custo de IA** cresce com o uso. O contexto é enxuto, as instruções ficam em cache e há limite por plano.
- **Notificações push e WhatsApp** vão precisar de um job agendado, por exemplo um cron a cada 5 minutos. Ele leria os mesmos alertas de `computeAlerts`, gravaria em `notifications` com `dedupe_key` (a proteção contra envio repetido já existe) e respeitaria o horário de silêncio de `user_preferences`.

## 9. Fase 2 (implementada)

### Quem vê o quê: `lib/access.ts`

Toda consulta de dados recebe um `Access`, que tem três partes:
- `userId`;
- o **plano efetivo** (membros de família herdam o plano FAMILY);
- a família, com um sinal que diz se ela está ativa.

A função `visible(tabela, access)` gera `user_id = eu OR household_id = minha família`, e só inclui a segunda parte se a família estiver ativa. Nas tabelas `events`, `tasks`, `shopping_lists`, `shopping_items` e `expenses`, a coluna `household_id` é opcional. Com ela nula, o item é pessoal.

Os testes cobrem estes casos:
- o vizinho não vê nada da família;
- um membro não conclui a tarefa pessoal de outro;
- quando o dono perde o plano Família, tudo deixa de ser compartilhado.

### Avisos: `lib/notify.ts`

O tick roda a cada 5 minutos. Para cada usuário que tem aparelho inscrito, ele segue estes passos:

1. Monta os candidatos a aviso:
   - os alertas do dia (`computeAlerts`);
   - lembretes com horário que venceram nos últimos 10 minutos;
   - compromissos que começam em até 1 hora.
2. Filtra os candidatos:
   - horário de silêncio (os lembretes com horário que o próprio usuário marcou passam mesmo assim);
   - janela por tipo (por exemplo, "amanhã você tem…" só a partir das 18h);
   - no máximo 2 avisos por rodada e 5 por dia.
3. **Grava em `notifications` antes de enviar.** O índice único em `(user_id, dedupe_key)` garante que o mesmo aviso não saia duas vezes, mesmo se o cron rodar em dobro.
4. Envia por Web Push para todos os aparelhos do usuário. Inscrições que retornam 404 ou 410 são removidas.

### Arquivos: `lib/storage.ts`

`upload → confere o tipo pelos primeiros bytes (PDF, PNG, JPEG, WEBP, HEIC) → AES-256-GCM (IV aleatório + tag) → disco ou S3/R2`

- **Chave:** `userId/uuid`.
- **Download:** exige ser o dono e é servido com `Content-Disposition`, `nosniff` e uma CSP `sandbox`.
- **Limites:** 10 MB por arquivo e 500 MB por usuário.

### Pagamentos: `lib/billing.ts`

```
/planos → CPF/CNPJ (validado, vai só para o Asaas) → POST /customers → POST /subscriptions (billingType UNDEFINED)
       → GET /subscriptions/{id}/payments → redireciona para invoiceUrl (Pix, boleto ou cartão)
webhook → billing_events (id do evento = idempotência) → PAYMENT_CONFIRMED/RECEIVED → users.plan
tick    → OVERDUE há mais de 7 dias ou CANCELED com período vencido → FREE
```

Tabelas: `billing_subscriptions` (estado da assinatura) e `billing_events` (eventos já recebidos).

### Família: `lib/family.ts`

- **Regras básicas:** uma família por pessoa e no máximo 5 membros. Só quem tem o plano FAMILY cria uma família.
- **Convite:**
  - o token tem 24 bytes aleatórios;
  - no banco fica só o hash sha256;
  - vale por 7 dias e é de uso único, marcado de forma atômica numa transação.
- **Na conversa com a Nina:**
  - a lista de compras é sempre da família;
  - compromissos e tarefas só são compartilhados com `shared: true`, que a IA marca quando a pessoa fala em "a gente", "família" ou "casa";
  - despesas só são compartilhadas quando a família ativou o compartilhamento de gastos.

### WhatsApp: `lib/whatsapp.ts`

```
Meta → POST /api/webhooks/whatsapp → confere HMAC-SHA256 (X-Hub-Signature-256) sobre o corpo bruto
     → responde 200 na hora; processa depois (after)
     → whatsapp_inbound (wamid = idempotência)
     → número desconhecido: procura código de 6 dígitos → vincula (users.phone)
     → número vinculado: texto/áudio → handleMessage() (a MESMA Nina do app) → resposta + cartões
       sugestão → botões de resposta "sg:<messageId>:1|0" → answerSuggestion()
```

O cliente da Graph API é uma interface (`WhatsAppClient`). Isso permite trocar o provedor e testar sem rede, que é o que os testes fazem.

### Tabelas novas (migração `0001_fase2.sql`)

| Área | Tabelas e colunas |
|---|---|
| Família | `households`, `household_members`, `household_invites` |
| Avisos | `push_subscriptions` |
| Pagamentos | `billing_subscriptions`, `billing_events` |
| WhatsApp | `whatsapp_link_codes`, `whatsapp_inbound` |
| Colunas em `users` | `asaas_customer_id`, `phone`, `phone_verified_at` |
| Coluna `household_id` | em `events`, `tasks`, `shopping_lists`, `shopping_items` e `expenses` |
| Colunas em `documents` | `file_name`, `mime_type`, `size_bytes` |

## 10. Próximos passos (fase 3)

1. **Avisos pelo WhatsApp** com templates aprovados pela Meta. O `notify.ts` ganha um segundo canal.
2. **Leitura de nota fiscal por foto:** a Nina extrai o valor, a loja e a data, e oferece cadastrar a garantia.
3. **Fila para o WhatsApp e para os avisos** (Upstash QStash ou BullMQ), quando o volume crescer.
4. **App nativo** (React Native ou Expo), reaproveitando as mesmas APIs. O PWA já cobre instalação e push.
5. **Categorias personalizadas** (a tabela já aceita `user_id`) e **orçamento por categoria**.
6. **Painel administrativo:** usuários, assinaturas e métricas de uso da IA (os logs já registram os tokens).
