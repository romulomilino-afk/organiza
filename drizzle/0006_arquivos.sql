CREATE TABLE IF NOT EXISTS "document_files" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_files" ADD CONSTRAINT "document_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
