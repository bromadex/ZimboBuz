import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "./money";

describe("formatMoney", () => {
  it.each([
    [2310, "USD", "USD 23.10"],
    [5, "USD", "USD 0.05"],
    [123456789, "ZWG", "ZiG 1,234,567.89"],
    [-150, "ZAR", "-ZAR 1.50"],
    [0, "USD", "USD 0.00"],
  ] as const)("formats %d %s as %s", (cents, currency, text) => {
    expect(formatMoney(cents, currency)).toBe(text);
  });
});

describe("parseMoney", () => {
  it("parses amounts into cents exactly", () => {
    expect(parseMoney("23.10")).toBe(2310);
    expect(parseMoney("1,234.5")).toBe(123450);
    expect(parseMoney("0.07")).toBe(7);
    expect(parseMoney("-2")).toBe(-200);
  });

  it("rejects ambiguous input", () => {
    expect(() => parseMoney("1.005")).toThrow();
    expect(() => parseMoney("abc")).toThrow();
    expect(() => parseMoney("")).toThrow();
  });
});
