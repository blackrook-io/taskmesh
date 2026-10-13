CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"project_id" integer,
	"source" text NOT NULL,
	"source_id" integer DEFAULT 0 NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading" text,
	"locator" integer,
	"start_offset" integer DEFAULT 0 NOT NULL,
	"end_offset" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector" NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_entity_source_uidx" UNIQUE("entity_type","entity_id","source","source_id","chunk_index"),
	CONSTRAINT "knowledge_chunks_entity_type_chk" CHECK ("knowledge_chunks"."entity_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board')),
	CONSTRAINT "knowledge_chunks_source_chk" CHECK ("knowledge_chunks"."source" in ('title', 'body', 'comment', 'extraction'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_entity_idx" ON "knowledge_chunks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_project_idx" ON "knowledge_chunks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_content_tsv_idx" ON "knowledge_chunks" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;