import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";
import { NotFoundError } from "../lib/notFound.js";
import {
  readMeshPositions,
  readMeshViewport,
  type MeshLayoutBody,
} from "../lib/meshLayoutRecord.js";
import { assertCanAccessEntity, assertCanAccessOwned } from "./ownership.js";

type Db = NodePgDatabase<typeof schema>;

export type MeshLayoutDto = {
  positions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number } | null;
};

async function assertMeshRoot(
  db: Db,
  actorId: number,
  rootType: EntityType | "tag",
  rootId: number,
): Promise<void> {
  if (rootType === "tag") {
    const [tag] = await db
      .select({ id: schema.tags.id, ownerId: schema.tags.ownerId })
      .from(schema.tags)
      .where(eq(schema.tags.id, rootId));
    if (!tag) throw new NotFoundError("Entity not found");
    await assertCanAccessOwned(db, actorId, tag.ownerId);
    return;
  }
  await assertCanAccessEntity(db, actorId, rootType, rootId);
}

function toDto(row: {
  positions: unknown;
  viewport: unknown;
}): MeshLayoutDto {
  return {
    positions: readMeshPositions(row.positions),
    viewport: readMeshViewport(row.viewport),
  };
}

export async function getMeshLayout(
  db: Db,
  actorId: number,
  rootType: EntityType | "tag",
  rootId: number,
  view: "focus",
): Promise<MeshLayoutDto | null> {
  await assertMeshRoot(db, actorId, rootType, rootId);
  const [row] = await db
    .select({ positions: schema.meshLayouts.positions, viewport: schema.meshLayouts.viewport })
    .from(schema.meshLayouts)
    .where(
      and(
        eq(schema.meshLayouts.ownerId, actorId),
        eq(schema.meshLayouts.rootType, rootType),
        eq(schema.meshLayouts.rootId, rootId),
        eq(schema.meshLayouts.view, view),
      ),
    );
  return row ? toDto(row) : null;
}

export async function putMeshLayout(
  db: Db,
  actorId: number,
  rootType: EntityType | "tag",
  rootId: number,
  view: "focus",
  body: MeshLayoutBody,
): Promise<MeshLayoutDto> {
  await assertMeshRoot(db, actorId, rootType, rootId);
  const now = new Date();
  const [row] = await db
    .insert(schema.meshLayouts)
    .values({
      ownerId: actorId,
      rootType,
      rootId,
      view,
      positions: body.positions,
      viewport: body.viewport,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.meshLayouts.ownerId,
        schema.meshLayouts.rootType,
        schema.meshLayouts.rootId,
        schema.meshLayouts.view,
      ],
      set: {
        positions: body.positions,
        viewport: body.viewport,
        updatedAt: now,
      },
    })
    .returning({
      positions: schema.meshLayouts.positions,
      viewport: schema.meshLayouts.viewport,
    });
  return toDto(row!);
}

export async function deleteMeshLayout(
  db: Db,
  actorId: number,
  rootType: EntityType | "tag",
  rootId: number,
  view: "focus",
): Promise<void> {
  await assertMeshRoot(db, actorId, rootType, rootId);
  await db
    .delete(schema.meshLayouts)
    .where(
      and(
        eq(schema.meshLayouts.ownerId, actorId),
        eq(schema.meshLayouts.rootType, rootType),
        eq(schema.meshLayouts.rootId, rootId),
        eq(schema.meshLayouts.view, view),
      ),
    );
}
