/**
 * System-only fields: never accepted from user input (API, UI, or import).
 * Writers are server/DB only (defaults, allocateTaskNumber, actor stamps).
 */

export const IMMUTABLE_FIELD_KEYS = [
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "createdById",
  "created_by_id",
  "createdBy",
  "created_by",
  "updatedById",
  "updated_by_id",
  "updatedBy",
  "updated_by",
  "ownerId",
  "owner_id",
  "owner",
  "number",
] as const;

const IMMUTABLE_SET = new Set<string>(IMMUTABLE_FIELD_KEYS);

export class ImmutableFieldError extends Error {
  readonly code = "immutable_field" as const;
  readonly status = 400 as const;
  readonly fields: string[];

  constructor(fields: string[]) {
    const unique = [...new Set(fields)];
    super(`Immutable field(s) cannot be set: ${unique.join(", ")}`);
    this.name = "ImmutableFieldError";
    this.fields = unique;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Keys present on a JSON body (any value, including null). */
export function findImmutableFields(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  return Object.keys(body).filter((k) => IMMUTABLE_SET.has(k));
}

function isEmptyImportValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Import rows may include blank columns; reject only when a value is supplied.
 */
export function findImmutableFieldsWithValues(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  return Object.keys(body).filter(
    (k) => IMMUTABLE_SET.has(k) && !isEmptyImportValue(body[k]),
  );
}

export function rejectImmutableFields(body: unknown): void {
  const fields = findImmutableFields(body);
  if (fields.length > 0) {
    throw new ImmutableFieldError(fields);
  }
}

export function rejectImmutableImportRow(body: unknown): void {
  const fields = findImmutableFieldsWithValues(body);
  if (fields.length > 0) {
    throw new ImmutableFieldError(fields);
  }
}

/** True when at least one listed key is present (value may be null). */
export function hasDefinedKeys(
  obj: object,
  keys: readonly string[],
): boolean {
  const record = obj as Record<string, unknown>;
  return keys.some((k) => record[k] !== undefined);
}
