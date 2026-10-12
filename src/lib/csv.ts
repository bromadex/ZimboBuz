// CSV for report exports (RFC 4180), safe to open in Excel and other
// spreadsheets: cells that a spreadsheet would treat as a formula (starting
// with =, +, -, @, or a tab or carriage return) get a leading apostrophe, so
// "=HYPERLINK(...)" typed as a customer name stays text. Plain numbers are
// written as numbers, so a negative amount like -12.50 is left alone.

export type CsvCell = string | number | bigint | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row plus data rows, with CRLF line endings and a BOM so Excel reads UTF-8 (ZiG, names with accents). */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A safe file name like "sales-by-day-2026-10-01-to-2026-10-12.csv". */
export function csvFileName(...parts: string[]): string {
  return `${parts.join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}.csv`;
}
