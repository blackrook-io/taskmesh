CREATE TABLE "entity_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"displayable" boolean DEFAULT true NOT NULL,
	"default_visible" boolean DEFAULT false NOT NULL,
	"default_sort_order" integer DEFAULT 0 NOT NULL,
	"sortable" boolean DEFAULT false NOT NULL,
	"scope" text,
	CONSTRAINT "entity_fields_entity_type_field_key_uidx" UNIQUE("entity_type","field_key")
);
--> statement-breakpoint
CREATE TABLE "user_list_view_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"list_view_key" text NOT NULL,
	"columns" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_list_view_prefs_user_list_uidx" UNIQUE("user_id","list_view_key")
);
--> statement-breakpoint
ALTER TABLE "user_list_view_prefs" ADD CONSTRAINT "user_list_view_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_fields_entity_type_idx" ON "entity_fields" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "user_list_view_prefs_user_id_idx" ON "user_list_view_prefs" USING btree ("user_id");--> statement-breakpoint
-- T0056 seed: list-displayable and non-displayable field metadata
INSERT INTO "entity_fields" ("entity_type", "field_key", "label", "displayable", "default_visible", "default_sort_order", "sortable", "scope") VALUES
  ('task', 'number', 'Number', true, true, 10, true, NULL),
  ('task', 'title', 'Title', true, true, 20, true, NULL),
  ('task', 'state', 'State', true, true, 30, true, NULL),
  ('task', 'assignee', 'Assignee', true, true, 40, false, NULL),
  ('task', 'priority', 'Priority', true, true, 50, true, NULL),
  ('task', 'dueDate', 'Due date', true, true, 60, true, NULL),
  ('task', 'project', 'Project', true, true, 70, true, 'global'),
  ('task', 'phase', 'Phase', true, false, 80, true, NULL),
  ('task', 'tags', 'Tags', true, false, 90, false, NULL),
  ('task', 'createdAt', 'Created', true, false, 100, true, NULL),
  ('task', 'updatedAt', 'Updated', true, false, 110, true, NULL),
  ('task', 'owner', 'Owner', true, false, 120, false, NULL),
  ('task', 'createdBy', 'Created by', true, false, 130, false, NULL),
  ('task', 'id', 'Id', false, false, 1000, false, NULL),
  ('task', 'sortOrder', 'Sort order', false, false, 1010, false, NULL),
  ('task', 'description', 'Description', false, false, 1020, false, NULL),
  ('task', 'color', 'Color', false, false, 1030, false, NULL),
  ('task', 'parentId', 'Parent', false, false, 1040, false, NULL),
  ('task', 'phaseId', 'Phase id', false, false, 1050, false, NULL),
  ('task', 'projectId', 'Project id', false, false, 1060, false, NULL),
  ('task', 'assigneeId', 'Assignee id', false, false, 1070, false, NULL),
  ('task', 'ownerId', 'Owner id', false, false, 1080, false, NULL),
  ('task', 'createdById', 'Created by id', false, false, 1090, false, NULL),
  ('task', 'updatedById', 'Updated by id', false, false, 1100, false, NULL),
  ('idea', 'title', 'Title', true, true, 10, true, NULL),
  ('idea', 'tags', 'Tags', true, true, 20, true, NULL),
  ('idea', 'createdAt', 'Created', true, true, 30, true, NULL),
  ('idea', 'number', 'Number', true, false, 40, true, NULL),
  ('idea', 'updatedAt', 'Updated', true, false, 50, true, NULL),
  ('idea', 'assignee', 'Assignee', true, false, 60, false, NULL),
  ('idea', 'id', 'Id', false, false, 1000, false, NULL),
  ('idea', 'body', 'Body', false, false, 1010, false, NULL),
  ('idea', 'ownerId', 'Owner id', false, false, 1020, false, NULL),
  ('idea', 'assigneeId', 'Assignee id', false, false, 1030, false, NULL);
