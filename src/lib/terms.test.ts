import { describe, expect, it } from "vitest";
import { DEFAULT_TERMS, termsFrom } from "./terms";

describe("termsFrom", () => {
  it("keeps the ordinary words unless the industry sets them", () => {
    expect(termsFrom(null)).toEqual(DEFAULT_TERMS);
    const t = termsFrom({ customers: "Members", product: "Giving type", invoice: 7, junk: "x" });
    expect(t.customers).toBe("Members");
    expect(t.customer).toBe("Customer");
    expect(t.product).toBe("Giving type");
    expect(t.invoice).toBe("Invoice");
    expect("junk" in t).toBe(false);
  });
});
