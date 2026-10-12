// A small CSV reader and writer (RFC 4180 style) for importing and exporting
// data: fields separated by commas, optionally wrapped in double quotes, with
// "" for a quote inside a quoted field; quoted fields may contain commas and
// line breaks. Lines end in LF, CRLF or CR. Spreadsheet programs add a byte
// order mark and blank lines at the end; both are ignored.

export class CsvError extends Error {}

/** Parses CSV text into rows of fields. Blank lines are skipped. */
export function parseCsv(input: string): string[][] {
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

function quote(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Writes rows as CSV with CRLF line endings (what spreadsheet programs expect). */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map((v) => quote(v === null || v === undefined ? "" : String(v))).join(",")).join("\r\n") + "\r\n";
}
