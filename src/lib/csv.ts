// A small CSV reader (imports) and writer (exports) (RFC 4180 style) for importing and exporting
// data: fields separated by commas, optionally wrapped in double quotes, with
// "" for a quote inside a quoted field; quoted fields may contain commas and
// line breaks. Lines end in LF, CRLF or CR. Spreadsheet programs add a byte
// order mark and blank lines at the end; both are ignored.

export class CsvError extends Error {}

/** Parses CSV text into rows of fields. Blank lines are skipped. */
export function parseCsv(input: string): string[][] {
  return parseRaw(input).map((row) => row.map(unprotect));
}

/** Undoes the apostrophe csvCell() puts before formula-like text ("'+263…" → "+263…"). */
function unprotect(field: string): string {
  return /^'[=+\-@]/.test(field) ? field.slice(1) : field;
}

function parseRaw(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // inside a quoted field
  let wasQuoted = false; // the current field started with a quote
  let line = 1;

  const endField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field.trim() === "" && !wasQuoted) {
        field = "";
        quoted = true;
        wasQuoted = true;
      } else if (wasQuoted) {
        throw new CsvError(`Line ${line}: there is text after a closing quote. Put the whole value inside the quotes.`);
      } else {
        // A quote in the middle of an unquoted value is kept as it is.
        field += c;
      }
    } else if (c === ",") {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
    } else if (wasQuoted) {
      if (c !== " " && c !== "\t") {
        throw new CsvError(`Line ${line}: there is text after a closing quote. Put the whole value inside the quotes.`);
      }
    } else {
      field += c;
    }
  }
  if (quoted) throw new CsvError(`Line ${line}: a quote is opened but never closed.`);
  if (field !== "" || wasQuoted || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Writing CSV (RFC 4180), safe to open in Excel and other
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
