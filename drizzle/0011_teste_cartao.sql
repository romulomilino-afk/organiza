-- Teste grátis agora exige cartão: o cadastro não ganha mais 7 dias automáticos.
ALTER TABLE "users" ALTER COLUMN "trial_ends_at" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "trial_ends_at" date;
