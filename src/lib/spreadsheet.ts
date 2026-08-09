import * as XLSX from "xlsx";

export type DiscardCode = "invalid_data" | "id_collision" | "db_reject" | "immutable_field";

export type DiscardRow = {
  row: number;
  code: DiscardCode;
  reason: string;
};

export type ImportResult = {
  created: number;
  discarded: DiscardRow[];
};

export function sheetToObjects(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const lower = filename.toLowerCase();
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    // still try first sheet
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows.map(normalizeKeys);
}

function normalizeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

export function objectsToCsv(rows: Record<string, unknown>[]): string {
  const ws = XLSX.utils.json_to_sheet(rows);
  return XLSX.utils.sheet_to_csv(ws);
}

export function objectsToXlsxBuffer(rows: Record<string, unknown>[], sheetName: string): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function workbookToBuffer(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/** Coerce spreadsheet cell to optional positive int (empty → undefined). */
export function optionalPositiveInt(value: unknown): number | undefined | "invalid" {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

export function parseOptionalDate(value: unknown): Date | null | "invalid" {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}
