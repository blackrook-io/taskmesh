CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_number_unique" UNIQUE("number")
);
--> statement-breakpoint
INSERT INTO "users" ("number", "display_name") VALUES (1, 'Local User');
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_by_id" integer;--> statement-breakpoint
UPDATE "tasks" SET "created_by_id" = (SELECT "id" FROM "users" WHERE "number" = 1), "updated_by_id" = (SELECT "id" FROM "users" WHERE "number" = 1);--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "updated_by_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
