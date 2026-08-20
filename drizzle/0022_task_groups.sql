UPDATE "tasks" SET "phase_id" = NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_phase_id_project_phases_id_fk";--> statement-breakpoint
ALTER TABLE "project_phases" RENAME TO "task_groups";--> statement-breakpoint
ALTER TABLE "task_groups" RENAME CONSTRAINT "project_phases_project_id_projects_id_fk" TO "task_groups_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "task_groups" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "task_groups" ADD COLUMN "filter" jsonb;--> statement-breakpoint
DELETE FROM "task_groups";
