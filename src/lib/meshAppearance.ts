import { z } from "zod";
import { ENTITY_TYPES, type EntityType } from "./entityType.js";

/** Mesh colors and accessibility stored in `system_properties.mesh_appearance`. */
export type MeshAppearance = {
  types: Record<EntityType, string>;
  suggestion: string;
  signals: { overdue: string; risk: string; stale: string };
  lines: { tree: number; ref: number; dep: number; suggested: number };
  glyphScale: number;
  labelSizeRem: number;
  badgePx: number;
  labelHalo: boolean;
  overduePulse: boolean;
  staleDays: number;
};

/** Matches the hardcoded `.mesh-panel` custom properties. */
export const MESH_APPEARANCE_DEFAULTS: MeshAppearance = {
  types: {
    project: "#8cb0e6",
    todo_list: "#95a5f3",
    task: "#5cc6b6",
    todo: "#f0a562",
    document: "#a8b7c7",
    idea: "#e0c158",
    board: "#7eb6d9",
    canvas: "#d4a0c8",
    wiki_node: "#9bbf8a",
    image_board: "#e7a3a3",
  },
  suggestion: "#e86aae",
  signals: {
    overdue: "#e57373",
    risk: "#f0b53c",
    stale: "#f0b53c",
  },
  lines: { tree: 1.4, ref: 1.3, dep: 1.3, suggested: 1.8 },
  glyphScale: 1,
  labelSizeRem: 0.8,
  badgePx: 13,
  labelHalo: true,
  overduePulse: true,
  staleDays: 30,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const hexColor = z
  .string()
  .regex(HEX, "must be a #rrggbb color")
  .transform((value) => value.toLowerCase());

const lineWeight = z.number().min(0.5).max(4);

export const meshAppearanceSchema = z
  .object({
    types: z
      .object({
        idea: hexColor,
        project: hexColor,
        task: hexColor,
        todo: hexColor,
        document: hexColor,
        todo_list: hexColor,
        board: hexColor,
        canvas: hexColor,
        wiki_node: hexColor,
        image_board: hexColor,
      })
      .strict(),
    suggestion: hexColor,
    signals: z
      .object({
        overdue: hexColor,
        risk: hexColor,
        stale: hexColor,
      })
      .strict(),
    lines: z
      .object({
        tree: lineWeight,
        ref: lineWeight,
        dep: lineWeight,
        suggested: lineWeight,
      })
      .strict(),
    glyphScale: z.number().min(0.75).max(1.5),
    labelSizeRem: z.number().min(0.7).max(1.2),
    badgePx: z.number().int().min(8).max(24),
    labelHalo: z.boolean(),
    overduePulse: z.boolean(),
    staleDays: z.number().int().min(1).max(365),
  })
  .strict();

function asHex(value: unknown, fallback: string): string {
  if (typeof value === "string" && HEX.test(value)) return value.toLowerCase();
  return fallback;
}

function asRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Field-by-field fallback for a missing or partial stored value. */
export function normalizeMeshAppearance(value: unknown): MeshAppearance {
  const raw = asRecord(value);
  const defaults = MESH_APPEARANCE_DEFAULTS;
  const types = asRecord(raw?.types);
  const signals = asRecord(raw?.signals);
  const lines = asRecord(raw?.lines);
  const typeColors = { ...defaults.types };
  for (const key of ENTITY_TYPES) {
    typeColors[key] = asHex(types?.[key], defaults.types[key]);
  }
  return {
    types: typeColors,
    suggestion: asHex(raw?.suggestion, defaults.suggestion),
    signals: {
      overdue: asHex(signals?.overdue, defaults.signals.overdue),
      risk: asHex(signals?.risk, defaults.signals.risk),
      stale: asHex(signals?.stale, defaults.signals.stale),
    },
    lines: {
      tree: asRange(lines?.tree, defaults.lines.tree, 0.5, 4),
      ref: asRange(lines?.ref, defaults.lines.ref, 0.5, 4),
      dep: asRange(lines?.dep, defaults.lines.dep, 0.5, 4),
      suggested: asRange(lines?.suggested, defaults.lines.suggested, 0.5, 4),
    },
    glyphScale: asRange(raw?.glyphScale, defaults.glyphScale, 0.75, 1.5),
    labelSizeRem: asRange(raw?.labelSizeRem, defaults.labelSizeRem, 0.7, 1.2),
    badgePx: asInt(raw?.badgePx, defaults.badgePx, 8, 24),
    labelHalo: typeof raw?.labelHalo === "boolean" ? raw.labelHalo : defaults.labelHalo,
    overduePulse: typeof raw?.overduePulse === "boolean" ? raw.overduePulse : defaults.overduePulse,
    staleDays: asInt(raw?.staleDays, defaults.staleDays, 1, 365),
  };
}

export function meshAppearanceEqual(a: MeshAppearance, b: MeshAppearance): boolean {
  return JSON.stringify(normalizeMeshAppearance(a)) === JSON.stringify(normalizeMeshAppearance(b));
}
