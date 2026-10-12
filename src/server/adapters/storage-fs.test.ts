import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAdapters } from "./index";
import { FileSystemStorage, isValidKey } from "./storage";

const company = "8f1d2c3b-4a5e-4f60-9a7b-1c2d3e4f5a6b";
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function storage() {
  const dir = await mkdtemp(join(tmpdir(), "zimerp-storage-"));
  dirs.push(dir);
  return { dir, s: new FileSystemStorage(dir) };
}

describe("file system storage", () => {
  it("stores files under the company's folder and reads them back", async () => {
    const { dir, s } = await storage();
    const f = await s.put(company, "site/photo.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(f).toEqual({ key: `${company}/site/photo.png`, contentType: "image/png", size: 3 });
    expect(await s.get(f.key)).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect((await readdir(join(dir, company, "site"))).sort()).toEqual(["photo.png", "photo.png.type"]);
  });

  it("never leaves the storage folder", async () => {
    const { s } = await storage();
    const f = await s.put(company, "../../../etc/passwd", new Uint8Array([1]), "text/plain");
    expect(f.key).toBe(`${company}/etc/passwd`);
    expect(await s.get("../../etc/passwd")).toBeNull();
    expect(await s.get(`${company}/../../x`)).toBeNull();
    expect(await s.get(`${company}/missing.png`)).toBeNull();
    await expect(s.put(company, "a.png", new Uint8Array([1]), "text/html\nx")).rejects.toThrow(/content type/);
  });

  it("checks keys", () => {
    expect(isValidKey(`${company}/site/a-b.png`)).toBe(true);
    expect(isValidKey(`${company}/../a.png`)).toBe(false);
    expect(isValidKey(`${company}//a.png`)).toBe(false);
    expect(isValidKey("not-a-company/a.png")).toBe(false);
    expect(isValidKey(`${company}/a b.png`)).toBe(false);
  });
});

describe("choosing storage", () => {
  it("uses memory in tests, the disk in development or when STORAGE_DIR is set", () => {
    expect(createAdapters({ NODE_ENV: "test" }).storage.name).toBe("memory");
    expect(createAdapters({ ADAPTERS: "fake", STORAGE_DIR: "/x" }).storage.name).toBe("memory");
    expect(createAdapters({ NODE_ENV: "development" }).storage.name).toBe("filesystem");
    expect(createAdapters({ NODE_ENV: "production", STORAGE_DIR: "/srv/files" }).storage.name).toBe("filesystem");
    const prod = createAdapters({ NODE_ENV: "production" });
    expect(prod.storage.name).toBe("memory");
    expect(prod.missing).toContain("storage");
  });
});
