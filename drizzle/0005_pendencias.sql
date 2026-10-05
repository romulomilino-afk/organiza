CREATE TABLE "deadlines" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'outro' NOT NULL,
	"due_date" date NOT NULL,
	"remind_days_before" integer DEFAULT 30 NOT NULL,
	"renew_months" integer,
	"notes" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_routines" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"household_id" text,
	"name" text NOT NULL,
	"every_days" integer DEFAULT 30 NOT NULL,
	"next_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_routines" ADD CONSTRAINT "shopping_routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_routines" ADD CONSTRAINT "shopping_routines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_user_idx" ON "deadlines" USING btree ("user_id","done","due_date");--> statement-breakpoint
CREATE INDEX "shopping_routines_user_idx" ON "shopping_routines" USING btree ("user_id","active","next_date");