import { describe, expect, it } from "vitest";
import { currencyLabel, formatDate, formatQuantity, money, todayIso } from "./format";

describe("display helpers", () => {
  it("formats money from database values", () => {
    expect(money("1250", "USD")).toBe("USD 12.50");
    expect(money(null, "USD")).toBe("—");
    expect(money(250, "ZWG ")).toBe("ZiG 2.50");
    expect(currencyLabel("ZWG")).toBe("ZiG");
  });

  it("formats dates and quantities for Zimbabwe", () => {
    expect(formatDate("2026-10-12")).toBe("12 Oct 2026");
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(todayIso(new Date("2026-10-12T23:30:00Z"))).toBe("2026-10-13");
  });
});
