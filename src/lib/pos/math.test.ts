import { describe, expect, it } from "vitest";
import { convert, lineAmounts, planTenders } from "./math";

const rates = { USD: 1, ZWG: 26.75 };

describe("till arithmetic", () => {
  it("splits VAT out of inclusive prices and adds it to exclusive ones", () => {
    expect(lineAmounts(2, 1150, 0, 1550, true)).toEqual({ net: 1991, tax: 309, total: 2300 });
    expect(lineAmounts(1, 1000, 100, 1550, false)).toEqual({ net: 900, tax: 140, total: 1040 });
    expect(() => lineAmounts(1, 100, 200, 0, true)).toThrow(/discount/);
  });

  it("converts at company rates", () => {
    expect(convert(250, "USD", "ZWG", rates)).toBe(6688);
    expect(convert(6688, "ZWG", "USD", rates)).toBe(250);
  });

  it("gives change from cash in the currency handed over", () => {
    expect(planTenders(2500, "USD", [{ method: "cash", currency: "USD", amountCents: 3000 }], rates)).toEqual({
      remainingCents: 0,
      change: [{ currency: "USD", cents: 500 }],
      problems: [],
    });
  });

  it("matches the database for a split EcoCash and ZiG cash sale", () => {
    const plan = planTenders(
      1250,
      "USD",
      [
        { method: "cash", currency: "ZWG", amountCents: 10000 },
        { method: "ecocash", currency: "USD", amountCents: 1000 },
      ],
      rates,
    );
    expect(plan).toEqual({ remainingCents: 0, change: [{ currency: "ZWG", cents: 3312 }], problems: [] });
  });

  it("gives change in another currency at the company rate", () => {
    expect(planTenders(100, "USD", [{ method: "cash", currency: "USD", amountCents: 500 }], rates, "ZWG").change).toEqual([{ currency: "ZWG", cents: 10700 }]);
  });

  it("reports short payment and card overpayment", () => {
    expect(planTenders(1000, "USD", [{ method: "cash", currency: "USD", amountCents: 400 }], rates).remainingCents).toBe(600);
    expect(planTenders(1000, "USD", [{ method: "card", currency: "USD", amountCents: 1200 }], rates).problems).toHaveLength(1);
  });
});
