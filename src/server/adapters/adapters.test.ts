import { describe, expect, it } from "vitest";
import { FakeDomainProvider, normaliseHostname, VercelDomainProvider } from "./domains";
import { ResendEmailSender } from "./email";
import type { FetchLike } from "./http";
import { createAdapters } from "./index";
import { toWhatsAppNumber, WhatsAppCloudMessenger } from "./messaging";
import { companyKey, MemoryFileStorage } from "./storage";

function recordingFetch(reply: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: status < 400, status, text: async () => JSON.stringify(reply) };
  };
  return { fetch, calls };
}

describe("createAdapters", () => {
  it("uses fakes everywhere when ADAPTERS=fake", () => {
    const a = createAdapters({ ADAPTERS: "fake", RESEND_API_KEY: "x" });
    expect([a.email.name, a.messaging.name, a.domains.name, a.payments.paynow.name]).toEqual(["fake", "fake", "fake", "fake"]);
    expect(a.missing).toEqual([]);
  });

  it("uses real adapters when configured and reports what is missing", () => {
    const a = createAdapters({ RESEND_API_KEY: "re_123" });
    expect(a.email.name).toBe("resend");
    expect(a.payments.paynow.name).toBe("paynow");
    expect(a.missing).toEqual(["whatsapp", "domains"]);
  });
});

describe("email (Resend)", () => {
  it("sends with the API key and maps fields", async () => {
    const { fetch, calls } = recordingFetch({ id: "em_1" });
    const r = await new ResendEmailSender("re_key", fetch).send({
      from: "Mhofu Hardware <accounts@mhofu.co.zw>",
      to: ["c@example.com"],
      subject: "Invoice INV-HQ-2026-0001",
      text: "Please find your invoice attached.",
      replyTo: "accounts@mhofu.co.zw",
    });
    expect(r.id).toBe("em_1");
    expect(calls[0].headers.authorization).toBe("Bearer re_key");
    expect(calls[0].body).toMatchObject({ subject: "Invoice INV-HQ-2026-0001", reply_to: "accounts@mhofu.co.zw" });
  });

  it("surfaces HTTP errors", async () => {
    const { fetch } = recordingFetch({ message: "invalid from" }, 422);
    await expect(
      new ResendEmailSender("k", fetch).send({ from: "x", to: ["y"], subject: "s", text: "t" }),
    ).rejects.toThrow(/HTTP 422/);
  });
});

describe("WhatsApp", () => {
  it.each([
    ["0771234567", "263771234567"],
    ["+263 77 123 4567", "263771234567"],
    ["771234567", "263771234567"],
    ["00263771234567", "263771234567"],
    ["27821234567", "27821234567"],
  ])("normalises %s to %s", (input, output) => {
    expect(toWhatsAppNumber(input)).toBe(output);
  });

  it("sends a text message through the Cloud API", async () => {
    const { fetch, calls } = recordingFetch({ messages: [{ id: "wamid.1" }] });
    const r = await new WhatsAppCloudMessenger("tok", "12345", "v21.0", fetch).sendText({ to: "0771234567", text: "Thank you" });
    expect(r.id).toBe("wamid.1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(calls[0].body).toMatchObject({ to: "263771234567", type: "text", text: { body: "Thank you" } });
  });
});

describe("storage", () => {
  const company = "8f1d2c3b-4a5e-4f60-9a7b-1c2d3e4f5a6b";
  it("keeps every file under its company and strips path tricks", () => {
    expect(companyKey(company, "../../other/logo.png")).toBe(`${company}/other/logo.png`);
    expect(() => companyKey("not-a-company", "x")).toThrow(/invalid company/);
    expect(() => companyKey(company, "../..")).toThrow(/invalid file path/);
  });

  it("stores and returns files", async () => {
    const s = new MemoryFileStorage();
    const f = await s.put(company, "logos/main.png", new Uint8Array([1, 2, 3]), "image/png");
    expect((await s.get(f.key))?.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.signedUrl(f.key, 60)).toContain(f.key);
  });
});

describe("domains", () => {
  it("validates hostnames", () => {
    expect(normaliseHostname("Shop.Mhofu.CO.ZW.")).toBe("shop.mhofu.co.zw");
    expect(() => normaliseHostname("not a domain")).toThrow(/not a valid domain/);
    expect(() => normaliseHostname("-bad.co.zw")).toThrow();
  });

  it("adds a domain on Vercel and returns verification records", async () => {
    const { fetch, calls } = recordingFetch({
      name: "mhofu.co.zw",
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.mhofu.co.zw", value: "vc-domain-verify=..." }],
    });
    const s = await new VercelDomainProvider("tok", "prj_1", "team_1", fetch).addDomain("Mhofu.co.zw");
    expect(calls[0].url).toBe("https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1");
    expect(s).toMatchObject({ hostname: "mhofu.co.zw", verified: false });
    expect(s.verification).toHaveLength(1);
  });

  it("fake provider verifies immediately", async () => {
    const d = new FakeDomainProvider();
    await d.addDomain("shop.example.co.zw");
    expect((await d.getDomain("shop.example.co.zw")).verified).toBe(true);
  });
});
