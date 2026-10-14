import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const { clientAddress } = await import("./rate-limit");

describe("client address", () => {
  it("takes the first forwarded address, then the real IP", () => {
    expect(clientAddress("41.1.2.3, 10.0.0.1", null)).toBe("41.1.2.3");
    expect(clientAddress(null, "41.9.9.9")).toBe("41.9.9.9");
    expect(clientAddress(null, null)).toBe("unknown");
  });
});
