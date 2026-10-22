import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PaynowGateway, paynowHash, parseFields, toPaymentState, verifyPaynowHash } from "./paynow";

const creds = { integrationId: "1201", integrationKey: "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977" };

/** Builds a signed Paynow reply body. */
function signed(fields: Array<[string, string]>, key = creds.integrationKey): string {
  return new URLSearchParams([...fields, ["hash", paynowHash(fields, key)]]).toString();
}

describe("paynowHash", () => {
  it("is SHA-512 of the values in order followed by the key, upper-case", () => {
    const fields: Array<[string, string]> = [
      ["id", "1201"],
      ["reference", "INV-HQ-2026-0001"],
      ["amount", "10.00"],
    ];
    const expected = createHash("sha512")
      .update("1201INV-HQ-2026-000110.00" + creds.integrationKey)
      .digest("hex")
      .toUpperCase();
    expect(paynowHash(fields, creds.integrationKey)).toBe(expected);
  });

  it("ignores an existing hash field", () => {
    const fields: Array<[string, string]> = [["a", "1"]];
    expect(paynowHash([...fields, ["hash", "X"]], "k")).toBe(paynowHash(fields, "k"));
  });
});

describe("verifyPaynowHash", () => {
  it("accepts authentic messages and rejects tampered ones", () => {
    const body = signed([
      ["reference", "INV-1"],
      ["amount", "10.00"],
      ["status", "Paid"],
    ]);
    expect(() => verifyPaynowHash(parseFields(body), creds.integrationKey)).not.toThrow();
    const tampered = body.replace("10.00", "1000.00");
    expect(() => verifyPaynowHash(parseFields(tampered), creds.integrationKey)).toThrow(/hash verification/);
    expect(() => verifyPaynowHash(parseFields(body), "other-key")).toThrow(/hash verification/);
  });
});

describe("toPaymentState", () => {
  it.each([
    ["Paid", "paid"],
    ["Awaiting Delivery", "paid"],
    ["Delivered", "paid"],
    ["Cancelled", "cancelled"],
    ["Sent", "pending"],
    ["Created", "pending"],
    ["Refunded", "refunded"],
    ["Disputed", "disputed"],
  ])("maps %s to %s", (raw, state) => {
    expect(toPaymentState(raw)).toBe(state);
  });
});

describe("PaynowGateway", () => {
  function gatewayReplying(reply: string, seen: Array<{ url: string; body: string }> = []) {
    return new PaynowGateway({
      fetch: async (url, init) => {
        seen.push({ url, body: init.body });
        return { ok: true, status: 200, text: async () => reply };
      },
    });
  }

  it("starts an EcoCash express checkout with a signed request", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const gw = gatewayReplying(
      signed([
        ["status", "Ok"],
        ["instructions", "Dial *151# and enter your PIN"],
        ["pollurl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"],
      ]),
      seen,
    );
    const started = await gw.startMobileCheckout(creds, {
      reference: "POS-HQ-2026-0042",
      amountCents: 2310,
      currency: "USD",
      description: "Till sale",
      phone: "077 123 4567",
      method: "ecocash",
      resultUrl: "https://erp.example.co.zw/api/payments/paynow/result",
    });
    expect(started.pollUrl).toContain("CheckPayment");
    expect(started.instructions).toContain("*151#");

    const sent = parseFields(seen[0].body);
    expect(seen[0].url).toMatch(/remotetransaction$/);
    expect(Object.fromEntries(sent)).toMatchObject({ amount: "23.10", phone: "0771234567", method: "ecocash", id: "1201" });
    expect(() => verifyPaynowHash(sent, creds.integrationKey)).not.toThrow();
  });

  it("reports gateway errors and rejects unsigned replies", async () => {
    await expect(
      gatewayReplying("status=Error&error=Invalid+amount").startWebCheckout(creds, {
        reference: "R",
        amountCents: 100,
        currency: "USD",
        description: "x",
        returnUrl: "https://a",
        resultUrl: "https://b",
      }),
    ).rejects.toThrow(/Invalid amount/);
    await expect(
      gatewayReplying("status=Ok&pollurl=https%3A%2F%2Fx&hash=BAD").startWebCheckout(creds, {
        reference: "R",
        amountCents: 100,
        currency: "USD",
        description: "x",
        returnUrl: "https://a",
        resultUrl: "https://b",
      }),
    ).rejects.toThrow(/hash verification/);
  });

  it("refuses non-integer or zero amounts", async () => {
    await expect(
      gatewayReplying("").startWebCheckout(creds, {
        reference: "R",
        amountCents: 10.5,
        currency: "USD",
        description: "x",
        returnUrl: "https://a",
        resultUrl: "https://b",
      }),
    ).rejects.toThrow(/whole number of cents/);
  });

  it("parses verified result notifications", () => {
    const gw = new PaynowGateway({ fetch: async () => ({ ok: true, status: 200, text: async () => "" }) });
    const body = signed([
      ["reference", "INV-HQ-2026-0001"],
      ["paynowreference", "987654"],
      ["amount", "23.10"],
      ["status", "Paid"],
      ["pollurl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"],
    ]);
    expect(gw.parseResultNotification(creds, body)).toMatchObject({
      reference: "INV-HQ-2026-0001",
      gatewayReference: "987654",
      amountCents: 2310,
      state: "paid",
    });
    expect(() => gw.parseResultNotification(creds, body.replace("Paid", "Cancelled"))).toThrow(/hash/);
  });
});
