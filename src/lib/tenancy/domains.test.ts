import { describe, expect, it } from "vitest";
import { dnsRecordFor, domainLabel, isApex, preferredOfPair, registrableDomain, wwwPartner } from "./domains";

const target = { cname: "sites.zimerp.co.zw", apexIp: "76.76.21.21" };

describe("own domains", () => {
  it("finds the part people buy", () => {
    expect(registrableDomain("www.mhofu.co.zw")).toBe("mhofu.co.zw");
    expect(registrableDomain("shop.mhofu.com")).toBe("mhofu.com");
    expect(registrableDomain("mhofu.co.zw")).toBe("mhofu.co.zw");
    expect(isApex("mhofu.co.zw")).toBe(true);
    expect(isApex("www.mhofu.co.zw")).toBe(false);
  });

  it("pairs bare and www names", () => {
    expect(wwwPartner("mhofu.co.zw")).toBe("www.mhofu.co.zw");
    expect(wwwPartner("www.mhofu.com")).toBe("mhofu.com");
    expect(wwwPartner("shop.mhofu.com")).toBeNull();
    expect(wwwPartner("erp.mhofu.co.zw")).toBeNull();
    expect(preferredOfPair("mhofu.co.zw", "www.mhofu.co.zw")).toBe("www.mhofu.co.zw");
  });

  it("gives the right DNS record", () => {
    expect(dnsRecordFor("mhofu.co.zw", target)).toEqual({ type: "A", name: "@", value: "76.76.21.21" });
    expect(dnsRecordFor("www.mhofu.co.zw", target)).toEqual({ type: "CNAME", name: "www", value: "sites.zimerp.co.zw" });
    expect(dnsRecordFor("erp.mhofu.com", target)).toEqual({ type: "CNAME", name: "erp", value: "sites.zimerp.co.zw" });
  });

  it("suggests a name from the company name", () => {
    expect(domainLabel("Mhofu Hardware (Pvt) Ltd")).toBe("mhofu-hardware");
    expect(domainLabel("Grace & Truth Ministries")).toBe("grace-and-truth-ministries");
  });
});
