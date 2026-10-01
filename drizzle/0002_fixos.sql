ALTER TABLE "income" ADD COLUMN "recurring_item_id" text;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD COLUMN "generated_until" date;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_recurring_item_id_recurring_items_id_fk" FOREIGN KEY ("recurring_item_id") REFERENCES "public"."recurring_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "income_recurring_date_uq" ON "income" USING btree ("recurring_item_id","date");