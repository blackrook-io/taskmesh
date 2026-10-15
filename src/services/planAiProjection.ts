import { createHash } from "node:crypto";
import type { PlanDependencyEdge, PlanItemRef } from "./plans.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LONG_OPEN_MS = 28 * 24 * 60 * 60 * 1000;
const EXCLUDED = new Set(["canceled", "deleted"]);

export type PlanAiAccess = "full" | "read_only" | "excluded" | "standalone";

export type PlanAiItem = {
  entityType: "task" | "todo";
  entityId: number;
  phaseName: string;
  title: string;
  state: string;
  estimateHours: number | null;
  progress?: number;
  parent: PlanItemRef | null;
  completedAt: string | null;
  createdAt: string;
};

export type PlanAiPacket = {
  today: string;
  baselineCenter: string;
  capacityHoursPerWeek: number | null;
  targetDate: string | null;
  phases: Array<{ name: string; remainingHours: number }>;
  criticalPath: Array<{ label: string; hours: number }> | null;
  weeklyCompletedHours: Array<{ weeksAgo: number; hours: number }>;
  unestimatedShare: number;
  longOpenCount: number;
  blockedChainCount: number;
  externalBlockerCount: number;
  items?: Array<{ title: string; state: string }>;
};

export type PlanAiConfidence = "low" | "medium" | "high";

export type PlanAiResult = {
  p50: string;
  p80: string;
  confidence: PlanAiConfidence;
  drivers: string[];
};

export class PlanAiParseError extends Error {
  readonly code = "malformed_projection";
  constructor() {
    super("The model did not return a finish range.");
    this.name = "PlanAiParseError";
  }
}

function itemKey(ref: PlanItemRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function counted(item: PlanAiItem): boolean {
  return !EXCLUDED.has(item.state);
}

function doneFraction(item: PlanAiItem): number {
  if (item.state === "complete" || item.state === "pending") return 1;
  if (item.entityType === "todo") {
    const progress = item.progress ?? 0;
    return Math.min(100, Math.max(0, progress)) / 100;
  }
  return 0;
}

function remainingOf(item: PlanAiItem): number {
  if (item.estimateHours == null) return 0;
  return item.estimateHours * (1 - doneFraction(item));
}

function leavesOf(items: PlanAiItem[]): PlanAiItem[] {
  const children = new Map<string, string[]>();
  const byKey = new Map<string, PlanAiItem>();
  for (const item of items) {
    const key = itemKey(item);
    byKey.set(key, item);
    if (!children.has(key)) children.set(key, []);
  }
  for (const item of items) {
    if (!item.parent) continue;
    const kids = children.get(itemKey(item.parent));
    if (kids) kids.push(itemKey(item));
  }
  return items.filter((item) => {
    if (!counted(item)) return false;
    const kids = children.get(itemKey(item)) ?? [];
    return !kids.some((key) => {
      const child = byKey.get(key);
      return child != null && counted(child);
    });
  });
}

function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 0;
  const day = parts[2] ?? 0;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysBetween(from: string, to: string): number {
  const parse = (iso: string) => {
    const parts = iso.split("-").map(Number);
    return Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

function longestChain(
  nodes: Array<{ key: string; hours: number; label: string }>,
  edges: Array<[string, string]>,
): Array<{ label: string; hours: number }> | null {
  const weight = new Map(nodes.map((node) => [node.key, node.hours]));
  const label = new Map(nodes.map((node) => [node.key, node.label]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.key, []);
    indegree.set(node.key, 0);
  }
  const seen = new Set<string>();
  for (const [from, to] of edges) {
    if (!weight.has(from) || !weight.has(to) || from === to) continue;
    const edgeKey = `${from}>${to}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const queue = [...indegree.keys()].filter((key) => (indegree.get(key) ?? 0) === 0);
  const topo: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key == null) break;
    topo.push(key);
    for (const next of outgoing.get(key) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (topo.length !== nodes.length) return null;
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const node of nodes) {
    dist.set(node.key, node.hours);
    prev.set(node.key, null);
  }
  for (const key of topo) {
    const base = dist.get(key) ?? 0;
    for (const next of outgoing.get(key) ?? []) {
      const candidate = base + (weight.get(next) ?? 0);
      if (candidate > (dist.get(next) ?? 0)) {
        dist.set(next, candidate);
        prev.set(next, key);
      }
    }
  }
  let end = nodes[0]?.key ?? "";
  let max = -1;
  for (const [key, value] of dist) {
    if (value > max) {
      max = value;
      end = key;
    }
  }
  const chain: Array<{ label: string; hours: number }> = [];
  let cursor: string | null = end;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    chain.push({ label: label.get(cursor) ?? "Item", hours: round4(weight.get(cursor) ?? 0) });
    cursor = prev.get(cursor) ?? null;
  }
  chain.reverse();
  return chain;
}

export function buildPlanAiPacket(input: {
  now: Date;
  includeTitles: boolean;
  capacityHoursPerWeek: number | null;
  targetDate: string | null;
  baselineCenter: string;
  items: PlanAiItem[];
  dependencies: PlanDependencyEdge[];
  externalBlockerCount: number;
}): PlanAiPacket {
  const leaves = leavesOf(input.items);
  const leafKeys = new Set(leaves.map(itemKey));
  const byKey = new Map(input.items.map((item) => [itemKey(item), item]));
  const phaseOrder: string[] = [];
  const phaseHours = new Map<string, number>();
  for (const item of leaves) {
    if (!phaseHours.has(item.phaseName)) {
      phaseOrder.push(item.phaseName);
      phaseHours.set(item.phaseName, 0);
    }
    phaseHours.set(item.phaseName, (phaseHours.get(item.phaseName) ?? 0) + remainingOf(item));
  }
  const open = leaves.filter((item) => doneFraction(item) < 1);
  const unestimated = leaves.filter((item) => item.estimateHours == null).length;
  const longOpen = open.filter((item) => {
    const at = Date.parse(item.createdAt);
    return Number.isFinite(at) && input.now.getTime() - at > LONG_OPEN_MS;
  }).length;
  const blocked = open.filter((item) =>
    input.dependencies.some((edge) => {
      if (itemKey(edge.dependent) !== itemKey(item)) return false;
      const prior = byKey.get(itemKey(edge.prerequisite));
      return prior != null && counted(prior) && doneFraction(prior) < 1;
    }),
  ).length;
  const weights = new Map(
    input.items.filter(counted).map((item) => [itemKey(item), leafKeys.has(itemKey(item)) ? remainingOf(item) : 0]),
  );
  const chain = longestChain(
    input.items.filter(counted).map((item, index) => ({
      key: itemKey(item),
      hours: weights.get(itemKey(item)) ?? 0,
      label: input.includeTitles ? item.title : `Item ${index + 1}`,
    })),
    input.dependencies.map((edge) => [itemKey(edge.prerequisite), itemKey(edge.dependent)]),
  );
  const weeklyCompletedHours = Array.from({ length: 8 }, (_, index) => {
    const weeksAgo = 7 - index;
    const end = input.now.getTime() - weeksAgo * WEEK_MS;
    const start = end - WEEK_MS;
    let hours = 0;
    for (const item of leaves) {
      if (item.state !== "complete" || item.completedAt == null || item.estimateHours == null) continue;
      const at = Date.parse(item.completedAt);
      if (!Number.isFinite(at) || at < start || at >= end) continue;
      hours += item.estimateHours;
    }
    return { weeksAgo, hours: round4(hours) };
  });
  const packet: PlanAiPacket = {
    today: utcDate(input.now),
    baselineCenter: input.baselineCenter,
    capacityHoursPerWeek: input.capacityHoursPerWeek,
    targetDate: input.targetDate,
    phases: phaseOrder.map((name) => ({ name, remainingHours: round4(phaseHours.get(name) ?? 0) })),
    criticalPath: chain,
    weeklyCompletedHours,
    unestimatedShare: leaves.length === 0 ? 0 : round4(unestimated / leaves.length),
    longOpenCount: longOpen,
    blockedChainCount: blocked,
    externalBlockerCount: input.externalBlockerCount,
  };
  if (input.includeTitles) {
    packet.items = open.map((item) => ({ title: item.title, state: item.state }));
  }
  return packet;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function hashPlanAiPacket(packet: PlanAiPacket): string {
  return createHash("sha256").update(JSON.stringify(stable(packet))).digest("hex");
}

export function parsePlanAiResult(text: string): PlanAiResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PlanAiParseError();
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlanAiParseError();
  }
  if (!raw || typeof raw !== "object") throw new PlanAiParseError();
  const record = raw as Record<string, unknown>;
  const p50 = record.p50;
  const p80 = record.p80;
  const confidence = record.confidence;
  const drivers = record.drivers;
  if (typeof p50 !== "string" || !isIsoDate(p50)) throw new PlanAiParseError();
  if (typeof p80 !== "string" || !isIsoDate(p80)) throw new PlanAiParseError();
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") throw new PlanAiParseError();
  if (!Array.isArray(drivers) || drivers.length === 0 || drivers.length > 5) throw new PlanAiParseError();
  const cleaned: string[] = [];
  for (const driver of drivers) {
    if (typeof driver !== "string") throw new PlanAiParseError();
    const line = driver.trim();
    if (!line || line.length > 160) throw new PlanAiParseError();
    cleaned.push(line);
  }
  return { p50, p80, confidence, drivers: cleaned };
}

/** True when both dates are today or later, P80 is not before P50, and neither is past 3× the baseline span. */
export function planAiWithinWindow(today: string, center: string, result: PlanAiResult): boolean {
  if (!isIsoDate(today) || !isIsoDate(center)) return false;
  if (daysBetween(today, result.p50) < 0 || daysBetween(today, result.p80) < 0) return false;
  if (daysBetween(result.p50, result.p80) < 0) return false;
  const span = Math.max(0, daysBetween(today, center));
  const limit = span * 3;
  return daysBetween(today, result.p50) <= limit && daysBetween(today, result.p80) <= limit;
}

export type PlanAiResolve =
  | { kind: "hidden" }
  | { kind: "cache" }
  | { kind: "accepted"; result: PlanAiResult }
  | { kind: "rejected"; reason: "malformed_projection" | "projection_out_of_range" };

export async function resolvePlanAi(input: {
  access: PlanAiAccess;
  hasCenter: boolean;
  packet: PlanAiPacket;
  cachedHash: string | null;
  force: boolean;
  complete: (packet: PlanAiPacket) => Promise<string>;
}): Promise<PlanAiResolve> {
  if (input.access === "excluded" || !input.hasCenter) return { kind: "hidden" };
  const nextHash = hashPlanAiPacket(input.packet);
  if (!input.force && input.cachedHash != null && input.cachedHash === nextHash) return { kind: "cache" };
  let text: string;
  try {
    text = await input.complete(input.packet);
  } catch (err) {
    throw err;
  }
  let result: PlanAiResult;
  try {
    result = parsePlanAiResult(text);
  } catch (err) {
    if (err instanceof PlanAiParseError) return { kind: "rejected", reason: "malformed_projection" };
    throw err;
  }
  if (!planAiWithinWindow(input.packet.today, input.packet.baselineCenter, result)) {
    return { kind: "rejected", reason: "projection_out_of_range" };
  }
  return { kind: "accepted", result };
}
