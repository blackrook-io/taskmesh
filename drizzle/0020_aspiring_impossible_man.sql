ALTER TABLE "projects" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "projects" p SET "sort_order" = s.n FROM (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY updated_at DESC, id ASC) - 1) AS n FROM "projects"
) s WHERE p.id = s.id;
