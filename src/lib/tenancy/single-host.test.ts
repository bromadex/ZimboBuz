import { describe, expect, it } from "vitest";
import { decideSingleHost, readView, singleHost, viewValue } from "./single-host";

describe("test mode on one address", () => {
  it("switches areas from entry paths, keeping the rest of the path", () => {
    expect(decideSingleHost("/erp/kuda", null)).toEqual({ kind: "enter", area: "erp", slug: "kuda", rest: "/" });
    expect(decideSingleHost("/site/kuda/account/auth", "erp:kuda")).toEqual({ kind: "enter", area: "site", slug: "kuda", rest: "/account/auth" });
    expect(decideSingleHost("/erp/Bad_Slug", null).kind).toBe("platform");
  });

  it("serves the company chosen in this browser, except ZimERP's own pages", () => {
    expect(decideSingleHost("/products", "erp:kuda")).toEqual({ kind: "company", area: "erp", slug: "kuda" });
    expect(decideSingleHost("/", "site:kuda")).toEqual({ kind: "company", area: "site", slug: "kuda" });
    expect(decideSingleHost("/signup", "erp:kuda")).toEqual({ kind: "platform" });
    expect(decideSingleHost("/signup/check-email", "erp:kuda")).toEqual({ kind: "platform" });
    expect(decideSingleHost("/", null)).toEqual({ kind: "platform" });
    expect(decideSingleHost("/leave", "erp:kuda")).toEqual({ kind: "leave" });
  });

  it("reads and writes the browser's choice safely", () => {
    expect(readView(viewValue("erp", "kuda"))).toEqual({ area: "erp", slug: "kuda" });
    expect(readView("erp:../x")).toBeNull();
    expect(readView("admin:kuda")).toBeNull();
  });

  it("is off unless configured", () => {
    expect(singleHost({})).toBeNull();
    expect(singleHost({ ZIMERP_SINGLE_HOST: "ZimERP.vercel.app" })).toBe("zimerp.vercel.app");
    expect(singleHost({ ZIMERP_SINGLE_HOST: "bad host/" })).toBeNull();
  });
});
