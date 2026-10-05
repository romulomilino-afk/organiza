# Integrações: passo a passo

Guia de configuração de cada serviço externo do Organiza. Nenhum deles é obrigatório para rodar o app. Cada um liga um recurso.

> **Webhooks em desenvolvimento:** o Asaas e a Meta precisam alcançar o seu computador por HTTPS. Para isso, use um túnel:
> `npx cloudflared tunnel --url http://localhost:3000` (ou o ngrok).
> Depois, use a URL `https://….trycloudflare.com` nos painéis dos serviços.

---

## 1. Notificações push

1. Rode `npm run secrets`. Copie `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `CRON_SECRET` para o `.env`.
2. Preencha `VAPID_SUBJECT` com `mailto:seu-email`.
3. Faça o build e rode (`npm run build && npm start`). O service worker só é registrado em produção.
4. Em **Minha conta → Avisos**, toque em **Ativar avisos**.
5. Coloque o tick para rodar a cada 5 minutos:
   - **local:** `npm run worker`;
   - **servidor:** `*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio/api/cron/tick`;
   - **Vercel:** crie um Cron Job para `/api/cron/tick` com `CRON_SECRET` definido. A Vercel envia o cabeçalho sozinha. O plano gratuito da Vercel só permite execução diária; para rodar a cada 5 minutos, use um agendador externo (cron-job.org, GitHub Actions ou o Upstash QStash).

**No iPhone,** os avisos só funcionam com o app instalado na tela inicial (Compartilhar → Adicionar à Tela de Início) e com iOS 16.4 ou mais recente. O app mostra essa instrução quando for o caso.

---

## 2. Arquivos (Documentos)

- **Em desenvolvimento,** não precisa configurar nada. Os arquivos vão para `./storage`, criptografados com uma chave derivada do `AUTH_SECRET`.
- **No Netlify,** também não precisa configurar nada. Os arquivos vão sozinhos para o **Netlify Blobs**, sempre criptografados. Sem `FILES_ENCRYPTION_KEY`, a chave vem do `AUTH_SECRET`. **Nesse caso, não troque o `AUTH_SECRET`**, ou os arquivos já guardados não abrem mais.
- **Em outros servidores:**
  1. Defina `FILES_ENCRYPTION_KEY` com a chave que `npm run secrets` gera. **Guarde essa chave em lugar seguro. Se ela se perder, os arquivos não podem mais ser abertos.**
  2. Para usar a nuvem, defina `STORAGE_DRIVER=s3` e preencha `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`.
  3. No Cloudflare R2, que é barato e não cobra pela saída de dados, preencha também `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` com `S3_REGION=auto`.

---

## 3. Pagamentos (Asaas)

1. Crie uma conta no **sandbox**: <https://sandbox.asaas.com>.
2. Em **Integrações → Chave de API**, gere a chave (ela começa com `$aact_hmlg_`). Coloque em `ASAAS_API_KEY`, com `ASAAS_ENV=sandbox`.
3. Em **Integrações → Webhooks**, crie um webhook:
   - **URL:** `https://SEU-DOMINIO/api/webhooks/asaas`
   - **Token de autenticação:** o valor de `ASAAS_WEBHOOK_TOKEN` (com 32 caracteres ou mais)
   - **Versão da API:** v3
   - **Eventos:** `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `SUBSCRIPTION_DELETED` e `SUBSCRIPTION_INACTIVATED`
4. **Teste:**
   1. No app, entre em **Planos → Assinar Premium**.
   2. Informe um CPF de teste válido, por exemplo 529.982.247-25.
   3. Na fatura do sandbox, clique em **Confirmar pagamento**. O plano muda sozinho.
5. **Para produção:** use a chave de produção e `ASAAS_ENV=production`, e recadastre o webhook na conta de produção.

**Como o sistema se comporta:**
- **Plano ativo:** o plano é ativado quando chega `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`.
- **Atraso:** com `PAYMENT_OVERDUE`, o acesso continua por 7 dias. Depois, volta para o Grátis. Se a pessoa pagar mais tarde, o plano volta.
- **Cancelamento:** o acesso vai até o fim do mês pago.
- **Estorno ou contestação:** o plano volta para o Grátis na hora.

---

## 4. WhatsApp (Cloud API da Meta)

1. Em <https://developers.facebook.com>, crie um app do tipo **Business** e adicione o produto **WhatsApp**.
2. Em **WhatsApp → Configuração da API**, você encontra um número de teste (ou pode adicionar o seu). Copie o **Phone number ID** para `WHATSAPP_PHONE_NUMBER_ID`.
3. **Token:** o token temporário do painel dura 24 horas. Para produção, crie um **usuário do sistema** no Business Manager e gere um token permanente com `whatsapp_business_messaging`. Coloque em `WHATSAPP_TOKEN`.
4. Em **Configurações do app → Básico**, copie a **Chave secreta do app** para `WHATSAPP_APP_SECRET`. Ela é usada para conferir a assinatura dos webhooks.
5. Em **WhatsApp → Configuração → Webhook**:
   - **URL de callback:** `https://SEU-DOMINIO/api/webhooks/whatsapp`
   - **Token de verificação:** o valor de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**.
6. Preencha `WHATSAPP_DISPLAY_NUMBER` com o número que aparece para os usuários, por exemplo `+55 21 99999-0000`.
7. **Teste:**
   1. No app, entre em **Minha conta → WhatsApp → Conectar meu WhatsApp**.
   2. Mande o código de 6 dígitos para o número.
   3. A Nina responde: "Pronto! Seu WhatsApp está conectado". A partir daí, é só conversar.

**Observações:**
- **Áudios:** precisam de `OPENAI_API_KEY` para a transcrição.
- **Custo:** mensagens de resposta dentro de 24 horas depois de uma mensagem do usuário são gratuitas ou muito baratas.
- **Avisos pelo WhatsApp fora dessa janela de 24 horas:** exigem **templates aprovados pela Meta**. Esse é o próximo passo natural. Os avisos já saem por push.
- **Desconectar:** o usuário pode mandar "desconectar" ou usar o botão no app.

---

## 5. IA da Nina e voz

| Chave | Onde conseguir |
|---|---|
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com>. O modelo padrão é o `claude-haiku-4-5-20251001` (rápido e barato). Para trocar, use `NINA_MODEL`. |
| `OPENAI_API_KEY` | <https://platform.openai.com>, para a transcrição (`gpt-4o-mini-transcribe`). |

## 6. Login com Google

Em **Google Cloud Console → APIs e serviços → Credenciais**, crie um **ID do cliente OAuth** do tipo Web:
- **Redirect URI:** `https://SEU-DOMINIO/api/auth/callback/google`
- Preencha `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET`.

---

## Checklist de produção

- [ ] `AUTH_URL` com o domínio real (https).
- [ ] Todos os segredos gerados com `npm run secrets`, e nenhum reaproveitado do exemplo.
- [ ] `FILES_ENCRYPTION_KEY` guardada num cofre de senhas.
- [ ] Postgres com backup automático e criptografia em repouso (Neon, Supabase e RDS já fazem isso).
- [ ] Cron a cada 5 minutos chamando `/api/cron/tick`.
- [ ] Webhooks do Asaas e da Meta apontando para o domínio de produção.
- [ ] `ASAAS_ENV=production` com a chave de produção.
- [ ] Mais de uma instância do app? Troque o limite de taxa em memória (`lib/rate-limit.ts`) por Redis ou Upstash.
