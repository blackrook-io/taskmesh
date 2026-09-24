import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  SpreadsheetLimitError,
  neutralizeSpreadsheetValue,
  objectsToCsv,
  sheetToObjects,
} from "./spreadsheet.js";

describe("neutralizeSpreadsheetValue", () => {
  it("prefixes formula-like values", () => {
    assert.equal(neutralizeSpreadsheetValue("=1+1"), "'=1+1");
    assert.equal(neutralizeSpreadsheetValue("+cmd"), "'+cmd");
    assert.equal(neutralizeSpreadsheetValue("-1+1"), "'-1+1");
    assert.equal(neutralizeSpreadsheetValue("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(neutralizeSpreadsheetValue("\t=1+1"), "'\t=1+1");
  });

  it("leaves safe text alone", () => {
    assert.equal(neutralizeSpreadsheetValue("Hello"), "Hello");
    assert.equal(neutralizeSpreadsheetValue("1+1"), "1+1");
    assert.equal(neutralizeSpreadsheetValue(""), "");
  });
});

describe("objectsToCsv formula injection", () => {
  it("neutralizes formula cells on export", () => {
    const csv = objectsToCsv([{ title: '=HYPERLINK("http://evil")', ok: "fine" }]);
    assert.match(csv, /'=HYPERLINK/);
    assert.match(csv, /fine/);
  });
});

describe("sheetToObjects XLSX bounds", () => {
  it("rejects workbooks with too many sheets", async () => {
    const prev = process.env.XLSX_MAX_SHEETS;
    process.env.XLSX_MAX_SHEETS = "2";
    try {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("a");
      wb.addWorksheet("b");
      wb.addWorksheet("c");
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      await assert.rejects(
        () => sheetToObjects(buf, "bomb.xlsx"),
        (err: unknown) =>
          err instanceof SpreadsheetLimitError && /too many sheets/i.test(err.message),
      );
    } finally {
      if (prev === undefined) delete process.env.XLSX_MAX_SHEETS;
      else process.env.XLSX_MAX_SHEETS = prev;
    }
  });

  it("rejects archives whose uncompressed size exceeds the cap", async () => {
    const prev = process.env.XLSX_MAX_UNCOMPRESSED_BYTES;
    process.env.XLSX_MAX_UNCOMPRESSED_BYTES = "32";
    try {
      const zip = new JSZip();
      zip.file("pad.bin", Buffer.alloc(64, 0x41));
      const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
      await assert.rejects(
        () => sheetToObjects(buf, "bomb.xlsx"),
        (err: unknown) =>
          err instanceof SpreadsheetLimitError && /uncompressed size/i.test(err.message),
      );
    } finally {
      if (prev === undefined) delete process.env.XLSX_MAX_UNCOMPRESSED_BYTES;
      else process.env.XLSX_MAX_UNCOMPRESSED_BYTES = prev;
    }
  });
});
