import { describe, expect, it } from "vitest";
import { harareDate, harareHour, summaryText } from "./daily-summary";

describe("summaryText", () => {
  it("summarises the day in plain English", () => {
    const text = summaryText({
      companyName: "Mhofu Hardware",
      date: "2026-10-12",
      sales: [
        { currency: "USD", count: 3, totalCents: "12050" },
        { currency: "ZWG", count: 1, totalCents: "26750" },
      ],
      payments: [{ currency: "USD", totalCents: "10000" }],
      owed: [{ currency: "USD", totalCents: "4500" }],
      lowStock: 2,
    });
    expect(text).toBe(
      [
        "Mhofu Hardware: summary for Mon 12 Oct",
        "Sales: USD 120.50 + ZiG 267.50 (4 invoices)",
        "Money received: USD 100.00",
        "Customers owe you: USD 45.00",
        "2 products are low on stock",
        "Change these messages in ZimERP under Settings, Notifications.",
      ].join("\n"),
    );
  });

  it("handles a quiet day", () => {
    const text = summaryText({ companyName: "X", date: "2026-10-11", sales: [], payments: [], owed: [], lowStock: 0 });
    expect(text).toContain("Sales: none today");
    expect(text).toContain("Money received: none today");
    expect(text).toContain("Customers owe you nothing");
    expect(text).not.toContain("low on stock");
  });
});

describe("Harare time", () => {
  it("is UTC+2", () => {
    const late = new Date("2026-10-12T22:30:00Z");
    expect(harareDate(late)).toBe("2026-10-13");
    expect(harareHour(late)).toBe(0);
    expect(harareHour(new Date("2026-10-12T16:00:00Z"))).toBe(18);
  });
});
