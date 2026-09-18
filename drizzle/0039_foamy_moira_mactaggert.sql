CREATE TABLE "user_project_overview_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"panels" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_project_overview_prefs_user_project_uidx" UNIQUE("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "user_project_overview_prefs" ADD CONSTRAINT "user_project_overview_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_overview_prefs" ADD CONSTRAINT "user_project_overview_prefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_project_overview_prefs_user_id_idx" ON "user_project_overview_prefs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_project_overview_prefs_project_id_idx" ON "user_project_overview_prefs" USING btree ("project_id");