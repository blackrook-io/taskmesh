DELETE FROM "mesh_layouts" WHERE "view" = 'plan';--> statement-breakpoint
ALTER TABLE "mesh_layouts" DROP CONSTRAINT "mesh_layouts_view_chk";--> statement-breakpoint
ALTER TABLE "mesh_layouts" ADD CONSTRAINT "mesh_layouts_view_chk" CHECK ("mesh_layouts"."view" in ('focus'));