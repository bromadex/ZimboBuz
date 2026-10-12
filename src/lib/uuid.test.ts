import { describe, expect, it } from "vitest";
import { uuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuid", () => {
  it("makes v4 ids with or without crypto.randomUUID", () => {
    expect(uuid()).toMatch(V4);
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), "randomUUID");
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(uuid()).toMatch(V4);
      expect(uuid()).not.toBe(uuid());
    } finally {
      delete (crypto as unknown as Record<string, unknown>).randomUUID;
      if (original && typeof crypto.randomUUID !== "function") Object.defineProperty(crypto, "randomUUID", original);
    }
  });
});
