-- Vale-alimentação / vale-refeição (cartão benefício da empresa): saldo próprio, não mexe na receita.
CREATE TABLE IF NOT EXISTS "benefit_cards" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "kind" text DEFAULT 'ALIMENTACAO' NOT NULL,
  "monthly_cents" integer DEFAULT 0 NOT NULL,
  "credit_day" integer DEFAULT 1 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "generated_until" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benefit_cards_user_idx" ON "benefit_cards" ("user_id","active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benefit_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "card_id" text NOT NULL REFERENCES "benefit_cards"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "description" text NOT NULL,
  "category_key" text DEFAULT 'alimentacao' NOT NULL,
  "date" date NOT NULL,
  "credit_ref" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benefit_entries_card_idx" ON "benefit_entries" ("card_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "benefit_entries_credit_uq" ON "benefit_entries" ("card_id","credit_ref");
