ALTER TABLE "todos" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_parent_id_todos_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."todos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todos_parent_id_idx" ON "todos" USING btree ("parent_id");