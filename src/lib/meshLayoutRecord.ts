import { z } from "zod";
import { ENTITY_TYPES } from "./entityType.js";

const ROOT_TYPES = [...ENTITY_TYPES, "tag"] as const;
const PIN_KEY = /^(idea|project|task|todo|document|todo_list|board|canvas|wiki_node|image_board|tag):\d+$/;

export const MAX_MESH_PINS = 500;

const pinSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
});

export const meshLayoutQuerySchema = z.object({
  root: z.string().regex(/^(idea|project|task|todo|document|todo_list|board|canvas|wiki_node|image_board|tag):\d+$/),
  view: z.enum(["focus", "plan"]),
});

export const meshLayoutBodySchema = z
  .object({
    positions: z.record(z.string().regex(PIN_KEY), pinSchema),
    viewport: z
      .object({
        x: z.number().finite().min(-1_000_000).max(1_000_000),
        y: z.number().finite().min(-1_000_000).max(1_000_000),
        zoom: z.number().finite().min(0.2).max(4),
      })
      .nullable(),
  })
  .strict()
  .refine((body) => Object.keys(body.positions).length <= MAX_MESH_PINS, {
    message: `At most ${MAX_MESH_PINS} pinned nodes`,
    path: ["positions"],
  });

export type MeshLayoutBody = z.infer<typeof meshLayoutBodySchema>;

export function parseMeshRoot(root: string): { rootType: (typeof ROOT_TYPES)[number]; rootId: number } {
  const [type, idRaw] = root.split(":");
  const rootType = z.enum(ROOT_TYPES).parse(type);
  const rootId = z.coerce.number().int().positive().parse(idRaw);
  return { rootType, rootId };
}

export function readMeshPositions(value: unknown): Record<string, { x: number; y: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [key, pin] of Object.entries(value)) {
    if (!PIN_KEY.test(key) || !pin || typeof pin !== "object") continue;
    const point = pin as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number") continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    positions[key] = { x: point.x, y: point.y };
  }
  return positions;
}

export function readMeshViewport(value: unknown): { x: number; y: number; zoom: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as { x?: unknown; y?: unknown; zoom?: unknown };
  if (typeof point.x !== "number" || typeof point.y !== "number" || typeof point.zoom !== "number") {
    return null;
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.zoom)) return null;
  return { x: point.x, y: point.y, zoom: point.zoom };
}
