import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, CsvError, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("splits simple rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF, CR and a missing final line break", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas, quotes and line breaks inside quoted fields", () => {
    expect(parseCsv('name,notes\n"Moyo, T","He said ""hi""\r\nthen left"\n')).toEqual([
      ["name", "notes"],
      ["Moyo, T", 'He said "hi"\r\nthen left'],
    ]);
  });

  it("keeps empty fields, including trailing ones", () => {
    expect(parseCsv("a,,c,\n,,,")).toEqual([
      ["a", "", "c", ""],
      ["", "", "", ""],
    ]);
    expect(parseCsv('a,""\n')).toEqual([["a", ""]]);
  });

  it("skips blank lines and a byte order mark", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\r\n\r\n")).toEqual([]);
  });

  it("trims spaces around unquoted values but not inside quotes", () => {
    expect(parseCsv(' a , b \n "  x  " , y')).toEqual([
      ["a", "b"],
      ["  x  ", "y"],
    ]);
  });

  it("keeps a stray quote in the middle of an unquoted value", () => {
    expect(parseCsv('Pipe 1/2",5')).toEqual([['Pipe 1/2"', "5"]]);
  });

  it("explains broken quoting in plain English", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(CsvError);
    expect(() => parseCsv('a,"b\n1,2')).toThrow(/never closed/);
    expect(() => parseCsv('a\n"b"c,d')).toThrow(/Line 2: there is text after a closing quote/);
  });

  it("reads back formula-like text that the writer protected", () => {
    expect(parseCsv(toCsv(["phone", "note"], [["+263 71 234 5678", "=SUM(A1)"]]))).toEqual([["phone", "note"], ["+263 71 234 5678", "=SUM(A1)"]]);
  });

  it("reads back what toCsv writes", () => {
    const rows = [
      ["code", "name", "notes"],
      ["A-1", 'Pipe 1/2"', "comma, here"],
      ["B", " padded ", "two\nlines"],
      ["C", "", ""],
    ];
    expect(parseCsv(toCsv(rows[0], rows.slice(1)))).toEqual(rows);
  });
});

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Cement 50kg")).toBe("Cement 50kg");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(BigInt(12))).toBe("12");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes commas, quotes, line breaks and edge spaces", () => {
    expect(csvCell("Moyo, Tendai")).toBe('"Moyo, Tendai"');
    expect(csvCell('6" nails')).toBe('"6"" nails"');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("stops formula injection", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"Click\")")).toBe('"\'=HYPERLINK(""http://evil"",""Click"")"');
    expect(csvCell("+263771234567")).toBe("'+263771234567");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
  });

  it("keeps negative numbers as numbers", () => {
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(-1250)).toBe("-1250");
  });
});

describe("toCsv", () => {
  it("writes a BOM, a header and CRLF rows", () => {
    expect(toCsv(["Name", "Total"], [["A, B", "1.00"], ["=cmd", null]])).toBe('﻿Name,Total\r\n"A, B",1.00\r\n\'=cmd,\r\n');
  });
});

describe("csvFileName", () => {
  it("makes a safe file name", () => {
    expect(csvFileName("Sales by day", "2026-10-01", "to", "2026-10-12")).toBe("sales-by-day-2026-10-01-to-2026-10-12.csv");
    expect(csvFileName("../etc/passwd")).toBe("etc-passwd.csv");
  });
});
