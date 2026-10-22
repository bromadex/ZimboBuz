import { describe, expect, it } from "vitest";
import { canRunReport, centsToDecimal, csvValue, findReport, reportRange, totalsByCurrency } from "./reports";

describe("reportRange", () => {
  it("defaults to this month so far", () => {
    expect(reportRange({}, "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
  });
  it("keeps valid dates, swaps reversed ones and ignores rubbish", () => {
    expect(reportRange({ from: "2026-01-01", to: "2026-03-31" }, "2026-10-12")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(reportRange({ from: "2026-03-31", to: "2026-01-01" }, "2026-10-12")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(reportRange({ from: "'; drop table", to: "2026-13-45" }, "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
  });
  it("limits the range to five years", () => {
    expect(reportRange({ from: "1990-01-01", to: "2026-10-12" }, "2026-10-12").from).toBe("2021-10-12");
  });
});

describe("centsToDecimal", () => {
  it.each([
    ["0", "0.00"],
    ["5", "0.05"],
    ["12050", "120.50"],
    ["-1250", "-12.50"],
    ["123456789012345", "1234567890123.45"],
  ])("%s → %s", (cents, out) => expect(centsToDecimal(cents)).toBe(out));
});

describe("totals and CSV values", () => {
  const def = findReport("sales-by-day")!;
  const rows = [
    { day: "2026-10-01", currency: "USD", invoices: 2, net: "1000", tax: "150", total: "1150" },
    { day: "2026-10-02", currency: "USD", invoices: 1, net: "500", tax: "75", total: "575" },
    { day: "2026-10-02", currency: "ZWG", invoices: 1, net: "2000", tax: "300", total: "2300" },
  ];

  it("sums money and counts per currency", () => {
    expect(totalsByCurrency(def, rows)).toEqual([
      { currency: "USD", invoices: 3, net: "1500", tax: "225", total: "1725" },
      { currency: "ZWG", invoices: 1, net: "2000", tax: "300", total: "2300" },
    ]);
  });

  it("writes money as decimals and rates as percentages", () => {
    const vat = findReport("vat-summary")!;
    const rate = vat.columns.find((c) => c.key === "rate")!;
    expect(csvValue(rate, { rate: 1550 })).toBe("15.5");
    expect(csvValue(def.columns[5], rows[0])).toBe("11.50");
  });
});

describe("canRunReport", () => {
  it("needs the report permission and the data permissions", () => {
    const stock = findReport("stock-valuation")!;
    expect(canRunReport(stock, new Set(["reports.view", "inventory.view"]))).toBe(false);
    expect(canRunReport(stock, new Set(["reports.view", "inventory.view", "core.products.view_cost"]))).toBe(true);
    expect(canRunReport(stock, new Set(["reports.view", "inventory.view", "core.products.view_cost"]), "export")).toBe(false);
    expect(canRunReport(stock, new Set(["reports.view", "reports.export", "inventory.view", "core.products.view_cost"]), "export")).toBe(true);
  });
});
