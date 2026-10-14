import { describe, expect, it } from "vitest";
import { allowsArea, cachedLookup, canonicalHost, classifyHost, databaseLookup, normaliseHost, storedLookupHost, type SiteRecord } from "./host";

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

describe("main addresses", () => {
  const record = { companySlug: "mhofu", kind: "website" as const, companyName: "Mhofu", siteHost: "www.mhofu.co.zw", erpHost: null };
  const site = (host: string) => classifyHost(host, "zimerp.co.zw") as Extract<ReturnType<typeof classifyHost>, { kind: "tenant" }>;

  it("sends website visitors to the main address", () => {
    expect(canonicalHost(record, site("mhofu.zimerp.co.zw"), "mhofu.zimerp.co.zw", "zimerp.co.zw")).toBe("www.mhofu.co.zw");
    expect(canonicalHost(record, site("mhofu.co.zw"), "mhofu.co.zw", "zimerp.co.zw")).toBe("www.mhofu.co.zw");
    expect(canonicalHost(record, site("www.mhofu.co.zw"), "www.mhofu.co.zw:443", "zimerp.co.zw")).toBeNull();
    expect(canonicalHost({ ...record, siteHost: "mhofu.zimerp.co.zw" }, site("mhofu.zimerp.co.zw"), "mhofu.zimerp.co.zw", "zimerp.co.zw")).toBeNull();
  });

  it("keeps the ZimERP ERP address unless the company has its own main ERP address", () => {
    expect(canonicalHost(record, site("erp.mhofu.zimerp.co.zw"), "erp.mhofu.zimerp.co.zw", "zimerp.co.zw")).toBeNull();
    expect(canonicalHost({ ...record, erpHost: "erp.mhofu.co.zw" }, site("erp.mhofu.zimerp.co.zw"), "erp.mhofu.zimerp.co.zw", "zimerp.co.zw")).toBe("erp.mhofu.co.zw");
    expect(canonicalHost({ ...record, kind: "erp" }, site("erp.old-name.co.zw"), "erp.old-name.co.zw", "zimerp.co.zw")).toBe("erp.mhofu.zimerp.co.zw");
  });
});

describe("databaseLookup", () => {
  it("reads the main addresses", async () => {
    const lookup = databaseLookup(async () => ({
      rows: [{ company_slug: "mhofu", kind: "website", company_name: "Mhofu", site_host: "www.mhofu.co.zw", erp_host: null }],
    }));
    expect(await lookup("mhofu.co.zw")).toEqual({ companySlug: "mhofu", kind: "website", companyName: "Mhofu", siteHost: "www.mhofu.co.zw", erpHost: null });
    expect(await databaseLookup(async () => ({ rows: [] }))("x.co.zw")).toBeNull();
  });
});

describe("staging platform domains", () => {
  it("looks free addresses up in their stored form and forwards within the staging domain", () => {
    const t = classifyHost("grace.zimerp.test:3100", "zimerp.test") as Extract<ReturnType<typeof classifyHost>, { kind: "tenant" }>;
    expect(storedLookupHost(t, "zimerp.test")).toBe("grace.zimerp.co.zw");
    const record = { companySlug: "grace", kind: "website" as const, companyName: "Grace", siteHost: "grace.zimerp.co.zw" };
    expect(canonicalHost(record, t, "grace.zimerp.test:3100", "zimerp.test")).toBeNull();
    const custom = classifyHost("www.grace.org.zw", "zimerp.test") as Extract<ReturnType<typeof classifyHost>, { kind: "tenant" }>;
    expect(storedLookupHost(custom, "zimerp.test")).toBe("www.grace.org.zw");
    expect(canonicalHost(record, custom, "www.grace.org.zw", "zimerp.test")).toBe("grace.zimerp.test");
  });
});
