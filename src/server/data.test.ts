import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { friendlyError } = await import("./data");

describe("friendlyError", () => {
  it("explains database rules in plain English", () => {
    expect(friendlyError({ code: "23505", constraint: "companies_slug_key" })).toMatch(/already taken/);
    expect(friendlyError({ code: "23514", constraint: "companies_slug_not_reserved" })).toMatch(/reserved/);
    expect(friendlyError({ code: "23514", message: "plan starter allows 1 modules" })).toBe(
      "The Starter plan allows up to 1 module. Switch something off or upgrade your plan.",
    );
    expect(friendlyError({ code: "42501", message: "permission denied for table products" })).toMatch(/permission/);
    expect(friendlyError({ message: 'new row violates row-level security policy for table "products"' })).toMatch(/permission/);
    expect(friendlyError(new Error("connection refused"))).toBe("Something went wrong. Please try again.");
  });
});
