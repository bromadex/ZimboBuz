import { describe, expect, it } from "vitest";
import { erpOrigin, platformDomain, requestProtocol, safeNextPath, siteOrigin } from "./urls";

describe("company addresses", () => {
  it("builds ERP and site origins, keeping the request port", () => {
    expect(erpOrigin("mhofu", "zimerp.co.zw", "zimerp.co.zw", "https")).toBe("https://erp.mhofu.zimerp.co.zw");
    expect(erpOrigin("mhofu", "zimerp.test", "zimerp.test:3000", "http")).toBe("http://erp.mhofu.zimerp.test:3000");
    expect(siteOrigin("mhofu", "zimerp.test", "zimerp.test:3000", "http")).toBe("http://mhofu.zimerp.test:3000");
  });

  it("reads the platform domain and protocol", () => {
    expect(platformDomain({})).toBe("zimerp.co.zw");
    expect(platformDomain({ ZIMERP_PLATFORM_DOMAIN: "Staging.ZimERP.co.zw" })).toBe("staging.zimerp.co.zw");
    expect(requestProtocol("https, http", "development")).toBe("https");
    expect(requestProtocol(null, "production")).toBe("https");
    expect(requestProtocol(undefined, "development")).toBe("http");
  });

  it("only allows relative next paths", () => {
    expect(safeNextPath("/products")).toBe("/products");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
