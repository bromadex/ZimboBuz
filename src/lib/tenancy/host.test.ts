import { describe, expect, it } from "vitest";
import { allowsArea, cachedLookup, classifyHost, normaliseHost, type SiteRecord } from "./host";

const P = "zimerp.co.zw";

describe("classifyHost", () => {
  it.each([
    ["zimerp.co.zw", { kind: "platform" }],
    ["www.zimerp.co.zw", { kind: "platform" }],
    ["localhost:3000", { kind: "platform" }],
    ["api.zimerp.co.zw", { kind: "platform" }],
    ["mhofu.zimerp.co.zw", { kind: "tenant", area: "site", lookupHost: "mhofu.zimerp.co.zw", custom: false }],
    ["MHOFU.zimerp.co.zw:443", { kind: "tenant", area: "site", lookupHost: "mhofu.zimerp.co.zw", custom: false }],
    ["erp.mhofu.zimerp.co.zw", { kind: "tenant", area: "erp", lookupHost: "mhofu.zimerp.co.zw", custom: false }],
    ["erp.admin.zimerp.co.zw", { kind: "invalid" }],
    ["a.b.zimerp.co.zw", { kind: "invalid" }],
    ["mhofu.co.zw", { kind: "tenant", area: "site", lookupHost: "mhofu.co.zw", custom: true }],
    ["erp.mhofu.co.zw", { kind: "tenant", area: "erp", lookupHost: "erp.mhofu.co.zw", custom: true }],
    ["", { kind: "invalid" }],
    ["bad host", { kind: "invalid" }],
  ])("%s", (host, expected) => {
    expect(classifyHost(host, P)).toEqual(expected);
  });

  it("normalises case, ports and trailing dots", () => {
    expect(normaliseHost(" Shop.Mhofu.CO.ZW.:8080 ")).toBe("shop.mhofu.co.zw");
  });
});

describe("allowsArea", () => {
  const record = (kind: SiteRecord["kind"]): SiteRecord => ({ companySlug: "mhofu", kind, companyName: "Mhofu" });
  it("only serves the ERP on domains registered for the ERP", () => {
    const erp = classifyHost("erp.mhofu.co.zw", P) as Extract<ReturnType<typeof classifyHost>, { kind: "tenant" }>;
    const site = classifyHost("mhofu.co.zw", P) as Extract<ReturnType<typeof classifyHost>, { kind: "tenant" }>;
    expect(allowsArea(record("erp"), erp)).toBe(true);
    expect(allowsArea(record("website"), erp)).toBe(false);
    expect(allowsArea(record("website"), site)).toBe(true);
    expect(allowsArea(record("erp"), site)).toBe(false);
  });
});

describe("cachedLookup", () => {
  it("caches hits and misses until they expire", async () => {
    let calls = 0;
    let clock = 0;
    const lookup = cachedLookup(
      async (h) => {
        calls++;
        return h === "known.co.zw" ? { companySlug: "known", kind: "website", companyName: "Known" } : null;
      },
      1000,
      () => clock,
    );
    await lookup("known.co.zw");
    await lookup("known.co.zw");
    await lookup("unknown.co.zw");
    await lookup("unknown.co.zw");
    expect(calls).toBe(2);
    clock = 2000;
    await lookup("known.co.zw");
    expect(calls).toBe(3);
  });
});
