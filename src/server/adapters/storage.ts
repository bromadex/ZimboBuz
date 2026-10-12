// File storage adapter (logos, product images, documents). Supabase Storage
// while building, Azure Blob after the move (§13); the server's disk for
// development and on-premise installs. Files are always stored per company:
// keys start with the company id.

import { promises as fs } from "node:fs";
import path from "node:path";

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

/** Checks a stored key: a company id, then path parts with no tricks. */
export function isValidKey(key: string): boolean {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._/-]+$/.test(key)) return false;
  return key.split("/").every((part) => part && part !== "." && part !== "..");
}

/**
 * Files on the server's disk, for development and on-premise installs
 * (STORAGE_DIR, default ./.data/storage). Each file sits under its company's
 * folder, with its content type beside it in a small ".type" file.
 */
export class FileSystemStorage implements FileStorage {
  readonly name = "filesystem";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private pathFor(key: string): string {
    if (!isValidKey(key)) throw new Error("invalid file key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid file key");
    return full;
  }

  async put(companyId: string, filePath: string, body: Uint8Array, contentType: string) {
    const key = companyKey(companyId, filePath);
    const full = this.pathFor(key);
    if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(contentType)) throw new Error("invalid content type");
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.type`, contentType);
    return { key, contentType, size: body.byteLength };
  }

  async get(key: string) {
    let full: string;
    try {
      full = this.pathFor(key);
    } catch {
      return null;
    }
    try {
      const [body, contentType] = await Promise.all([fs.readFile(full), fs.readFile(`${full}.type`, "utf8")]);
      return { body: new Uint8Array(body), contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async signedUrl(key: string, expiresInSeconds: number) {
    // Files are served by the application (src/app/api/files); only public
    // files are served there, so this is the plain address.
    this.pathFor(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `/api/files/${key}?expires=${expires}`;
  }
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
