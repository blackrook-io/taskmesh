import type { CSSProperties } from "react";
import { ENTITY_TYPES, type EntityType } from "./entityType";

/** Mesh colors and accessibility from `GET /api/v1/config`. Mirrors `src/lib/meshAppearance.ts`. */
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

export function isMeshHex(value: string): boolean {
  return HEX.test(value);
}

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

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const n = Number.parseInt(match[0].slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, or null when either color is not `#rrggbb`. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a == null || b == null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastBelowMinimum(
  foreground: string,
  background: string,
  minimum = 3,
): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio != null && ratio < minimum;
}

function rem(value: number): string {
  return `${Number(value.toFixed(2))}rem`;
}

/** Inline custom properties for `.mesh-panel` and the admin preview. */
export function meshAppearanceStyle(appearance: MeshAppearance): CSSProperties {
  const scale = appearance.glyphScale;
  const style: Record<string, string> = {
    "--mesh-rel-suggested": appearance.suggestion,
    "--mesh-signal-overdue": appearance.signals.overdue,
    "--mesh-signal-risk": appearance.signals.risk,
    "--mesh-signal-stale": appearance.signals.stale,
    "--mesh-line-tree": String(appearance.lines.tree),
    "--mesh-line-ref": String(appearance.lines.ref),
    "--mesh-line-dep": String(appearance.lines.dep),
    "--mesh-line-suggested": String(appearance.lines.suggested),
    "--mesh-glyph": `${Number((22 * scale).toFixed(2))}px`,
    "--mesh-glyph-focus": `${Number((28 * scale).toFixed(2))}px`,
    "--mesh-label-size": rem(appearance.labelSizeRem),
    "--mesh-label-size-focus": rem(appearance.labelSizeRem + 0.15),
    "--mesh-badge": `${appearance.badgePx}px`,
    "--mesh-stale-days": String(appearance.staleDays),
    "--mesh-pulse": appearance.overduePulse ? "1" : "0",
  };
  for (const key of ENTITY_TYPES) {
    style[`--mesh-type-${key}`] = appearance.types[key];
  }
  return style as CSSProperties;
}
