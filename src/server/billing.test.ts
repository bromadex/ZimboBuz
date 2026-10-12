import { describe, expect, it } from "vitest";
import { billingGateway, settle } from "./billing";

describe("billingGateway", () => {
  it("uses ZimERP's Paynow account when configured", () => {
    const b = billingGateway({ PAYNOW_ZIMERP_INTEGRATION_ID: "1", PAYNOW_ZIMERP_INTEGRATION_KEY: "k", NODE_ENV: "production" });
    expect(b.mode).toBe("paynow");
    if (b.mode === "paynow") expect(b.credentials).toEqual({ integrationId: "1", integrationKey: "k" });
  });

  it("uses the test checkout with ADAPTERS=fake or in development", () => {
    expect(billingGateway({ ADAPTERS: "fake", PAYNOW_ZIMERP_INTEGRATION_ID: "1", PAYNOW_ZIMERP_INTEGRATION_KEY: "k" }).mode).toBe("test");
    expect(billingGateway({ NODE_ENV: "development" }).mode).toBe("test");
  });

  it("never offers pretend payments in production", () => {
    expect(billingGateway({ NODE_ENV: "production" }).mode).toBe("unavailable");
  });
});

describe("settle", () => {
  it("ignores anything but a paid status", async () => {
    const db = { query: async () => ({ rows: [] }) } as never;
    expect(await settle(db, "paynow", { reference: "ZIM-1", state: "pending", rawStatus: "Sent" })).toBe(false);
  });
});
