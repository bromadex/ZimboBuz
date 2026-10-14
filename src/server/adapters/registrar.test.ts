import { describe, expect, it } from "vitest";
import { FakeRegistrar, ManualRegistrar } from "./registrar";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe("domain registrars", () => {
  it("reads availability from DNS", async () => {
    const r = (answer: () => Promise<string[]>) => new ManualRegistrar(answer);
    expect(await r(async () => ["ns1.example.net"]).checkAvailability("mhofu.co.zw")).toBe("taken");
    expect(await r(async () => { throw dnsError("ENOTFOUND"); }).checkAvailability("mhofu.co.zw")).toBe("available");
    expect(await r(async () => { throw dnsError("ETIMEOUT"); }).checkAvailability("mhofu.co.zw")).toBe("unknown");
    expect(await r(async () => []).register()).toEqual({ status: "pending" });
  });

  it("fake registrar registers each name once", async () => {
    const r = new FakeRegistrar();
    expect(await r.checkAvailability("taken.co.zw")).toBe("taken");
    expect(await r.register("new-shop.co.zw", 1)).toMatchObject({ status: "registered" });
    expect(await r.checkAvailability("new-shop.co.zw")).toBe("taken");
    expect(await r.register("new-shop.co.zw", 1)).toMatchObject({ status: "failed" });
  });
});
