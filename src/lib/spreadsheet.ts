import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Readable } from "node:stream";

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

/** Soft caps against ZIP bombs / pathological workbooks (beyond the 20 MB upload limit). */
export const XLSX_MAX_SHEETS = 50;
export const XLSX_MAX_ROWS = 100_000;
export const XLSX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export class SpreadsheetLimitError extends Error {
  readonly status = 400;
  readonly code = "spreadsheet_too_large";

  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetLimitError";
  }
}

/**
 * Neutralize CSV/Excel formula injection: values that Excel would treat as
 * formulas get a leading apostrophe (stored/displayed as text).
 */
export function neutralizeSpreadsheetValue(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.length === 0) return s;
  // Leading tab/CR can still trigger formula mode in some spreadsheet apps.
  const trigger = s.replace(/^[\t\r]+/, "");
  if (/^[=+\-@]/.test(trigger) || /^[=+\-@]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function cellValueToPlain(value: ExcelJS.CellValue): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((t) => t.text).join("");
  }
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value) return value.result ?? "";
  if ("formula" in value) return "";
  if ("error" in value) return "";
  if ("sharedFormula" in value) return "";
  return String(value);
}

function worksheetToObjects(sheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values : [];
    // ExcelJS row.values is 1-indexed (index 0 unused).
    const cells = values.slice(1).map((v) => cellValueToPlain(v as ExcelJS.CellValue));
    if (rowNumber === 1) {
      headers = cells.map((c, i) => {
        const key = String(c ?? "").trim();
        return key || `column_${i + 1}`;
      });
      return;
    }
    const out: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const raw = cells[i];
      out[key] = typeof raw === "string" ? raw.trim() : (raw ?? "");
    }
    rows.push(out);
  });
  return rows;
}

function maxUncompressedBytes(): number {
  const fromEnv = Number(process.env.XLSX_MAX_UNCOMPRESSED_BYTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return XLSX_MAX_UNCOMPRESSED_BYTES;
}

function maxSheets(): number {
  const fromEnv = Number(process.env.XLSX_MAX_SHEETS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return XLSX_MAX_SHEETS;
}

function maxRows(): number {
  const fromEnv = Number(process.env.XLSX_MAX_ROWS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return XLSX_MAX_ROWS;
}

async function assertXlsxSafe(buffer: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { createFolders: false });
  } catch {
    throw new SpreadsheetLimitError("Workbook is not a valid XLSX archive");
  }
  const limit = maxUncompressedBytes();
  let uncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    // `_data.uncompressedSize` is set for entries loaded from a ZIP.
    const data = entry as JSZip.JSZipObject & {
      _data?: { uncompressedSize?: number };
    };
    const size = data._data?.uncompressedSize;
    if (typeof size === "number" && Number.isFinite(size) && size >= 0) {
      uncompressed += size;
    }
    if (uncompressed > limit) {
      throw new SpreadsheetLimitError(
        `Workbook uncompressed size exceeds ${limit} bytes`,
      );
    }
  }
}

function assertWorkbookBounds(workbook: ExcelJS.Workbook): void {
  const sheets = workbook.worksheets;
  const sheetLimit = maxSheets();
  if (sheets.length > sheetLimit) {
    throw new SpreadsheetLimitError(
      `Workbook has too many sheets (max ${sheetLimit})`,
    );
  }
  const rowLimit = maxRows();
  let rows = 0;
  for (const sheet of sheets) {
    rows += sheet.rowCount;
    if (rows > rowLimit) {
      throw new SpreadsheetLimitError(
        `Workbook has too many rows (max ${rowLimit})`,
      );
    }
  }
}

/**
 * Parse the first sheet of a .csv or .xlsx upload into row objects.
 * Legacy `.xls` (BIFF) is not supported by ExcelJS — callers should reject it.
 */
export async function sheetToObjects(
  buffer: Buffer,
  filename: string,
): Promise<Record<string, unknown>[]> {
  const lower = filename.toLowerCase();
  const workbook = new ExcelJS.Workbook();
  if (lower.endsWith(".csv")) {
    await workbook.csv.read(Readable.from(buffer), {
      map: (value) => value,
    });
  } else {
    await assertXlsxSafe(buffer);
    // ExcelJS typings expect Node Buffer; cast avoids Buffer generic mismatch under TS 5.7+.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    assertWorkbookBounds(workbook);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  return worksheetToObjects(sheet).map(normalizeKeys);
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

function csvEscape(value: unknown): string {
  const s = neutralizeSpreadsheetValue(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Sync CSV writer (no ExcelJS dependency for text export). */
export function objectsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  const lines = [keys.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(keys.map((k) => csvEscape(row[k])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function writeSheet(workbook: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  const ws = workbook.addWorksheet(name.slice(0, 31));
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]!);
  ws.addRow(keys);
  for (const row of rows) {
    ws.addRow(
      keys.map((k) => {
        const v = row[k];
        if (v instanceof Date) return v;
        if (v == null) return "";
        if (typeof v === "number" || typeof v === "boolean") return v;
        return neutralizeSpreadsheetValue(v);
      }),
    );
  }
}

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const out = await workbook.xlsx.writeBuffer();
  if (Buffer.isBuffer(out)) return out;
  return Buffer.from(out as ArrayBuffer);
}

export async function objectsToXlsxBuffer(
  rows: Record<string, unknown>[],
  sheetName: string,
): Promise<Buffer> {
  return workbookToBuffer([{ name: sheetName, rows }]);
}

export async function workbookToBuffer(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const s of sheets) {
    writeSheet(workbook, s.name, s.rows);
  }
  return workbookBuffer(workbook);
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
