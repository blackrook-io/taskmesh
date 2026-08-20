import { sql, type SQL } from "drizzle-orm";

/**
 * Postgres LIKE/ILIKE metacharacters. Bound parameters still treat `%` / `_`
 * as wildcards unless ESCAPE is set — always pair with `ilikeEscaped`.
 */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Contains-match pattern: `%escaped%`. */
export function ilikeContains(raw: string): string {
  return `%${escapeIlikePattern(raw)}%`;
}

/** Case-insensitive contains match with `ESCAPE` so `%`/`_` are literal. */
export function ilikeEscaped(column: unknown, raw: string): SQL {
  return sql`${column} ILIKE ${ilikeContains(raw)} ESCAPE chr(92)`;
}
