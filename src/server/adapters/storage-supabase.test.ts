import { describe, expect, it } from "vitest";
import { createAdapters } from "./index";
import { SupabaseStorage } from "./storage";

const COMPANY = "22222222-2222-4222-8222-222222222222";

function storage(status: { bucket?: number } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const files = new Map<string, { body: ArrayBuffer; type: string }>();
  const s = new SupabaseStorage("https://abc.supabase.co", "service-key", "zimerp-files", async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    expect((init?.headers as Record<string, string>).apikey).toBe("service-key");
    if (url.endsWith("/bucket/zimerp-files")) return new Response("{}", { status: status.bucket ?? 404 });
    if (url.endsWith("/bucket")) return new Response("{}", { status: 200 });
    const key = url.split("/object/zimerp-files/")[1];
    if (method === "POST") {
      files.set(key, { body: await new Response(init!.body as BodyInit).arrayBuffer(), type: (init!.headers as Record<string, string>)["content-type"] });
      return new Response("{}");
    }
    const f = files.get(key);
    return f ? new Response(f.body, { headers: { "content-type": f.type } }) : new Response("{}", { status: 404 });
  });
  return { s, calls };
}

describe("Supabase Storage", () => {
  it("creates the private bucket once, then stores and reads files by company", async () => {
    const { s, calls } = storage();
    const stored = await s.put(COMPANY, "site/logo.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(stored.key).toBe(`${COMPANY}/site/logo.png`);
    await s.put(COMPANY, "site/other.png", new Uint8Array([4]), "image/png");
    expect(calls.filter((c) => c.url.endsWith("/bucket")).length).toBe(1);
    expect(await s.get(stored.key)).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(await s.get(`${COMPANY}/site/missing.png`)).toBeNull();
    expect(await s.get("../../etc/passwd")).toBeNull();
  });

  it("refuses odd paths and content types", async () => {
    const { s } = storage({ bucket: 200 });
    await expect(s.put("not-a-company", "x.png", new Uint8Array(), "image/png")).rejects.toThrow();
    await expect(s.put(COMPANY, "x.png", new Uint8Array(), "text/html; script")).rejects.toThrow(/content type/);
  });

  it("is chosen when Supabase is configured", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", NODE_ENV: "production" };
    expect(createAdapters(env).storage.name).toBe("supabase");
    expect(createAdapters({ ...env, STORAGE: "filesystem", STORAGE_DIR: "/tmp/x" }).storage.name).toBe("filesystem");
    expect(createAdapters({ ...env, ADAPTERS: "fake" }).storage.name).toBe("memory");
  });
});
