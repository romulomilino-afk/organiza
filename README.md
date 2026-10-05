# Organiza

**Você fala. A gente organiza.**

O Organiza é um assistente pessoal. Você conversa com a **Nina** pelo app ou pelo WhatsApp, por texto ou áudio, e ela transforma o que você diz em compromissos, tarefas, lembretes, despesas, contas, lista de compras, documentos e garantias. Sem formulário nenhum.

> "Amanhã preciso levar meu filho ao médico às 15h e depois passar no mercado. Também preciso pagar a conta de luz sexta-feira."
>
> A Nina cria:
> - 📅 um compromisso amanhã às 15:00;
> - ✅ a tarefa "Passar no mercado" para amanhã;
> - 🧾 a conta de luz com vencimento na sexta.
>
> Depois, pergunta se deve lembrar você 1 dia antes. Na véspera, avisa no celular.

---

## Rodando localmente

**Pré-requisitos:** Node.js 20 ou mais recente e Docker (para o PostgreSQL).

```bash
npm install
cp .env.example .env
npm run secrets               # gera todos os segredos; cole a saída no .env
npm run setup                 # sobe o Postgres no Docker e aplica as migrações
npm run dev                   # abre em http://localhost:3000
npm run worker                # (outro terminal) avisos e manutenção das assinaturas, a cada 5 min
```

Se você não tem Docker, use um Postgres gratuito na nuvem, como o Neon ou o Supabase. Coloque o endereço do banco em `DATABASE_URL` e rode `npm run db:migrate` no lugar de `npm run setup`.

### O que cada chave liga

Só `DATABASE_URL` e `AUTH_SECRET` são obrigatórios. O resto liga recursos, e a configuração passo a passo de cada integração está em [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md).

| Chaves | O que liga | Sem elas |
|---|---|---|
| `ANTHROPIC_API_KEY` | A Nina com IA (Claude) | Modo simples, com regras |
| `OPENAI_API_KEY` | Transcrição de áudio no servidor e áudios do WhatsApp | Voz pelo próprio navegador |
| `VAPID_*` + `CRON_SECRET` | Notificações no celular e no computador | Alertas só dentro do app |
| `FILES_ENCRYPTION_KEY`, `STORAGE_*`, `S3_*` | Arquivos de documentos criptografados, em disco ou em S3/R2 | Em desenvolvimento, a chave é derivada do `AUTH_SECRET` |
| `ASAAS_*` | Assinaturas Premium e Família (Pix, boleto ou cartão) | A tela de planos aparece, mas sem cobrança |
| `WHATSAPP_*` | A Nina no WhatsApp (API oficial da Meta) | Sem WhatsApp |
| `AUTH_GOOGLE_*` | Login com Google | Só e-mail e senha |

### Comandos

| Comando | Para quê |
|---|---|
| `npm run dev` / `npm run build && npm start` | Desenvolvimento / produção |
| `npm run worker` | Roda o "tick" (avisos e assinaturas) a cada 5 minutos, localmente |
| `npm test` | 50 testes de ponta a ponta, contra um Postgres real em memória (PGlite), sem Docker |
| `npm run typecheck` | Checagem de tipos |
| `npm run secrets` | Gera AUTH_SECRET, CRON_SECRET, a chave de arquivos, as chaves VAPID e os tokens de webhook |
| `npm run db:generate` / `npm run db:migrate` | Gera / aplica migrações |

---

## O que o sistema faz

**MVP (fase 1)**
- Cadastro e login.
- Onboarding em 4 telas.
- Início com microfone e resumo do dia.
- Chat com a Nina, com cartões de confirmação e botões de sugestão.
- Entrada por texto e por voz.
- Tarefas, agenda com rotinas e lembretes.
- Financeiro básico, com contas mensais.
- Lista de compras.
- Memória da Nina.
- Alertas inteligentes.
- Interface mobile-first com tema claro e escuro.

**Fase 2**
- **Notificações push e app instalável.**
  - Avisos no celular: compromisso em 1 hora, lembrete na hora marcada, conta vencendo, documento vencendo, compras paradas.
  - Os avisos respeitam o horário de silêncio, têm limite diário e cada coisa é avisada uma vez só.
  - O app instala na tela inicial (PWA) e tem uma tela para quando estiver sem conexão.
- **Minha Casa**, com quatro abas:
  - Compras.
  - **Documentos**: upload de PDF e foto, com criptografia AES-256 e aviso antes de vencer.
  - **Garantias**: calculadas a partir da nota fiscal ou pelo que você disser à Nina.
  - **Assinaturas**: com os totais mensal e anual.
- **Pagamentos com Asaas.**
  - Premium por R$ 19,90 e Família por R$ 29,90, com cobrança automática no cartão.
  - O webhook ativa o plano, e eventos repetidos são ignorados.
  - Se o pagamento atrasar, há 7 dias de carência antes de voltar ao Grátis.
  - É possível cancelar a qualquer momento, e o acesso continua até o fim do mês pago.
- **Fixos do mês.**
  - Receita fixa ("meu salário de 4.200 cai todo dia 5"): entra sozinha nas receitas no dia.
  - Despesa fixa ("pago 1.500 de aluguel todo dia 10"): lança sozinha como paga no dia.
  - Conta fixa ("... me avisa para pagar"): vira conta a pagar todo mês, com aviso e botão "Paguei".
  - A tela Dinheiro mostra quanto entra, quanto sai e quanto sobra por mês. Também dá para cadastrar e parar por lá.
- **Categorias de cada pessoa.**
  - "Cria a categoria Pet com ração e veterinário" ou "barbearia vai na categoria Beleza".
  - As palavras-chave valem para os próximos lançamentos e já movem os antigos.
  - As categorias padrão continuam disponíveis e também aceitam palavras-chave ("academia vai na categoria Saúde").
  - A tela Dinheiro tem o quadro "Minhas categorias", para criar e apagar.
- **Cartões de crédito.**
  - "Meu Nubank fecha dia 3 e vence dia 10" cadastra o cartão e calcula o melhor dia de compra.
  - "Comprei uma TV de 3.000 em 10x no Nubank" gera as 10 parcelas, cada uma na fatura certa.
  - A aba Cartões mostra a fatura a pagar, a fatura aberta, as próximas faturas, as parcelas em andamento e o limite usado.
  - A fatura entra em "Contas a pagar", com aviso e o botão "Paguei".
  - As parcelas do mês contam nos gastos e nas categorias.
- **Não deixe nada passar** (página `/pendencias`).
  - Problema: "A geladeira está fazendo barulho" → "Quer que eu crie uma tarefa para amanhã às 10h?"
  - Vencimento: "Meu seguro vence em dezembro" → avisa 30 dias antes e renova todo ano.
  - Garantia: "Comprei uma TV hoje, garantia de 12 meses" → garantia até out/2027, com aviso antes.
  - Compra de rotina: "Ração quando estiver acabando" → volta para a lista a cada ~30 dias e recomeça a contagem quando a pessoa compra.
- **Assistente de Pendências** (tela inicial).
  - Uma lista "Hoje" com 🔴 vencido, 🟡 fazer hoje ou em breve, 🔵 compromissos e 🟢 o que está chegando.
  - Cada item tem uma ação rápida (concluir, Paguei, Renovei).
  - Abaixo, o "Tem algo que você precisa resolver? 🎙️".
- **Posso gastar?**
  - Calcula a margem do mês: receitas previstas menos gastos, contas, fixos, parcelas do cartão e assinaturas, deixando uma folga de 10%.
  - Simula compras à vista e parceladas ("Posso comprar um celular de R$ 1.500?").
- **Moedas: Real, Dólar e Euro.**
  - Cada pessoa escolhe a moeda em Minha conta, e os valores já registrados podem ser convertidos pela cotação do dia.
  - "Gastei 50 dólares" é convertido para a moeda da pessoa.
  - A tela Dinheiro tem um conversor.
- **Cobrança automática no cartão:** a assinatura é só por cartão de crédito, e o Asaas Checkout recorrente cobra sozinho todo mês.
- **Plano Família.**
  - Até 5 pessoas, com convite por link de uso único.
  - Lista de compras da família, e agenda e tarefas compartilhadas quando você disser "a gente…" ou "da família".
  - Gastos da casa compartilhados, se a família quiser.
- **WhatsApp.**
  - A mesma Nina, por texto ou áudio.
  - As sugestões viram botões.
  - O número é conectado por um código de 6 dígitos, sem SMS.

---

## Estrutura

```
src/
  app/(auth)            login, cadastro
  app/onboarding        4 passos
  app/(app)/            início · nina · agenda · financeiro · casa · planos · familia · config
  app/convite/[token]   aceitar convite da família
  app/api/
    chat, chat/suggestion         conversa com a Nina
    transcribe                    áudio → texto
    push                          inscrição de notificações
    documents, documents/[id]/file  upload e download (criptografados)
    cron/tick                     avisos + manutenção de assinaturas (agendador)
    webhooks/asaas                pagamentos
    webhooks/whatsapp             WhatsApp Cloud API
  lib/nina/        prompt, contexto, ★ intenções (zod), LLM, regras, executor, orquestrador
  lib/access.ts    ★ quem vê o quê (pessoal × família) — todas as consultas passam aqui
  lib/notify.ts    o "vigia": decide o que avisar e quando
  lib/billing.ts   Asaas
  lib/family.ts    família e convites
  lib/whatsapp.ts  WhatsApp
  lib/storage.ts   arquivos criptografados (local ou S3/R2)
  lib/push.ts      Web Push
  db/schema.ts     todas as tabelas
public/sw.js       service worker (push + offline)
drizzle/           migrações SQL
tests/             nina.test.ts (MVP) · fase2.test.ts · fixos.test.ts · categorias.test.ts · cartoes.test.ts · pendencias.test.ts
docs/              ARQUITETURA.md · INTEGRACOES.md
```

## Segurança, em resumo

- **Senhas:** bcrypt, com limite de tentativas e o mesmo tempo de resposta quando o e-mail existe e quando não existe.
- **Sessão:** JWT assinado. O middleware protege todas as rotas.
- **Isolamento dos dados:**
  - o `userId` vem só da sessão;
  - itens de família só são visíveis para membros e enquanto o plano Família estiver ativo;
  - há testes cobrindo isso.
- **A IA nunca acessa o banco.** Ela devolve intenções, que são validadas e executadas no escopo do usuário.
- **Webhooks autenticados:**
  - o Asaas é conferido pelo token no cabeçalho, em tempo constante;
  - o WhatsApp é conferido pela assinatura HMAC-SHA256 do corpo bruto;
  - os dois são idempotentes.
- **Arquivos:**
  - criptografados com AES-256-GCM antes de serem gravados;
  - o tipo é conferido pelos primeiros bytes do arquivo;
  - o download exige ser o dono e é servido com `nosniff` e uma CSP restritiva;
  - cada usuário tem uma cota de 500 MB.
- **CPF/CNPJ:** vai direto para o Asaas e **não é guardado** no Organiza.
- **Convites:** no banco fica só o hash do token. O link é de uso único e expira em 7 dias.
- **Logs:** JSON estruturado, sem conteúdo de mensagens nem credenciais.
