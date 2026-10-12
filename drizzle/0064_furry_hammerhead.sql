CREATE TABLE "document_extractions" (
	"document_id" integer PRIMARY KEY NOT NULL,
	"upload_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extractions_status_chk" CHECK ("document_extractions"."status" in ('pending', 'ready', 'empty', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "document_text_spans" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"locator" integer NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_text_spans_document_ordinal_uidx" UNIQUE("document_id","ordinal")
);
--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_text_spans" ADD CONSTRAINT "document_text_spans_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_text_spans_document_locator_idx" ON "document_text_spans" USING btree ("document_id","locator");