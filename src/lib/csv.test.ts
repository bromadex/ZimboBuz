import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, toCsv } from "./csv";

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
