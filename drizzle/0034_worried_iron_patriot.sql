ALTER TABLE "project_documents" ADD COLUMN "kind" text DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "upload_id" integer;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;