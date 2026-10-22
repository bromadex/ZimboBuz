import { describe, expect, it } from "vitest";
import { termsFrom } from "@/lib/terms";
import { visibleNav } from "./nav";

describe("ERP menu", () => {
  it("shows only what the user may open", () => {
    const cashier = visibleNav(new Set(["pos.sell", "pos.view", "core.customers.view", "core.products.view"]));
    const labels = cashier.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Till");
    expect(labels).toContain("Exchange rates");
    expect(labels).not.toContain("Invoices");
    expect(labels).not.toContain("Users");
    expect(cashier.map((g) => g.label)).not.toContain("Website");
  });

  it("uses the company's own words", () => {
    const groups = visibleNav(new Set(["core.customers.view", "core.products.view"]), termsFrom({ customers: "Members", products: "Giving types" }));
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(expect.arrayContaining(["Members", "Giving types"]));
    expect(labels).not.toContain("Customers");
  });
});
