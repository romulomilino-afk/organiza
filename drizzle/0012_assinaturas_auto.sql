-- Assinaturas viram lançamento automático no dia da cobrança: na conta (despesa) ou no cartão escolhido.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_day" integer;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "card_id" text REFERENCES "credit_cards"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "subscription_id" text REFERENCES "subscriptions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_subscription_date_uq" ON "expenses" ("subscription_id", "date");
--> statement-breakpoint
ALTER TABLE "card_purchases" ADD COLUMN IF NOT EXISTS "subscription_id" text REFERENCES "subscriptions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_purchases_subscription_date_uq" ON "card_purchases" ("subscription_id", "purchase_date");
