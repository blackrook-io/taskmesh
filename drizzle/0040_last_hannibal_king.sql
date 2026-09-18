CREATE TABLE "project_overview_defaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_overview_defaults_project_uidx" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_overview_defaults" ADD CONSTRAINT "project_overview_defaults_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_overview_defaults" ADD CONSTRAINT "project_overview_defaults_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_overview_defaults_project_id_idx" ON "project_overview_defaults" USING btree ("project_id");