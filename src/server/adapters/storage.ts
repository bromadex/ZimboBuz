// File storage adapter (logos, product images, documents). Supabase Storage
// while building, Azure Blob after the move (§13). Files are always stored per
// company: keys start with the company id.

export interface StoredFile {
  key: string;
  contentType: string;
  size: number;
}

export interface FileStorage {
  readonly name: string;
  put(companyId: string, path: string, body: Uint8Array, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /** Short-lived private link for viewing or downloading. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export function companyKey(companyId: string, path: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new Error("invalid company id");
  const clean = path
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!clean) throw new Error("invalid file path");
  return `${companyId.toLowerCase()}/${clean}`;
}

export class MemoryFileStorage implements FileStorage {
  readonly name = "memory";
  private readonly files = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(companyId: string, path: string, body: Uint8Array, contentType: string) {
    const key = companyKey(companyId, path);
    this.files.set(key, { body, contentType });
    return { key, contentType, size: body.byteLength };
  }

  async get(key: string) {
    return this.files.get(key) ?? null;
  }

  async signedUrl(key: string, expiresInSeconds: number) {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `memory://${key}?expires=${expires}`;
  }
}
