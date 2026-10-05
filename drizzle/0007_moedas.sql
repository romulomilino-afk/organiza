CREATE TABLE "fx_rates" (
	"day" date PRIMARY KEY NOT NULL,
	"rates" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "method" text DEFAULT 'UNDEFINED' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "currency" text DEFAULT 'BRL' NOT NULL;