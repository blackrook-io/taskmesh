ALTER TABLE "ideas" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "ideas" AS i
SET "sort_order" = s.n - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS n
  FROM "ideas"
) AS s
WHERE i.id = s.id;