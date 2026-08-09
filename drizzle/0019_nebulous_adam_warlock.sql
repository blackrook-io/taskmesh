ALTER TABLE "boards" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "image_boards" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "todo_lists" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "boards" b SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "boards") s WHERE b.id = s.id;--> statement-breakpoint
UPDATE "canvases" c SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "canvases") s WHERE c.id = s.id;--> statement-breakpoint
UPDATE "ideas" i SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "ideas") s WHERE i.id = s.id;--> statement-breakpoint
UPDATE "image_boards" ib SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "image_boards") s WHERE ib.id = s.id;--> statement-breakpoint
UPDATE "project_documents" d SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "project_documents") s WHERE d.id = s.id;--> statement-breakpoint
UPDATE "projects" p SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "projects") s WHERE p.id = s.id;--> statement-breakpoint
UPDATE "todo_lists" t SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "todo_lists") s WHERE t.id = s.id;--> statement-breakpoint
UPDATE "wiki_nodes" w SET "number" = s.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM "wiki_nodes") s WHERE w.id = s.id;--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "image_boards" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_lists" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_nodes" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "image_boards" ADD CONSTRAINT "image_boards_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD CONSTRAINT "wiki_nodes_number_unique" UNIQUE("number");
