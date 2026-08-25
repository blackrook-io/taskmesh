CREATE TABLE "db_stats_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"database_size_bytes" bigint NOT NULL,
	"table_count" integer NOT NULL,
	"database_count" integer NOT NULL,
	"datname" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD COLUMN "request_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD COLUMN "response_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "db_stats_snapshots_sampled_at_idx" ON "db_stats_snapshots" USING btree ("sampled_at");