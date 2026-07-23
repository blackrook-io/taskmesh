import type { Request } from "express";
import { z } from "zod";

const idParam = z.coerce.number().int().positive();

/** Express `req.params` typing does not include merged parent params; parse by key. */
export function parseRouteId(req: Request, key: string): number {
  const raw = (req.params as Record<string, string | undefined>)[key];
  return idParam.parse(raw);
}
