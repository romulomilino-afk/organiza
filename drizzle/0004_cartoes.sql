CREATE TABLE "card_installments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"purchase_id" text NOT NULL,
	"number" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"description" text NOT NULL,
	"total_cents" integer NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"purchase_date" date NOT NULL,
	"category_key" text DEFAULT 'outros' NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"closing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"limit_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_installments" ADD CONSTRAINT "card_installments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_installments" ADD CONSTRAINT "card_installments_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_installments" ADD CONSTRAINT "card_installments_purchase_id_card_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."card_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_invoice_payments" ADD CONSTRAINT "card_invoice_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_invoice_payments" ADD CONSTRAINT "card_invoice_payments_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_inst_user_due_idx" ON "card_installments" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "card_inst_card_due_idx" ON "card_installments" USING btree ("card_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "card_inst_purchase_number_uq" ON "card_installments" USING btree ("purchase_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "card_invoice_paid_uq" ON "card_invoice_payments" USING btree ("card_id","due_date");--> statement-breakpoint
CREATE INDEX "card_purchases_user_idx" ON "card_purchases" USING btree ("user_id","card_id");--> statement-breakpoint
CREATE INDEX "credit_cards_user_idx" ON "credit_cards" USING btree ("user_id","active");