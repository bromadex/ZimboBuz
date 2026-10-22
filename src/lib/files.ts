// Checks uploaded pictures by their content, never by the name or the type the
// browser claims (P20 logos, website images).

export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const MAX_IMAGE_BYTES = 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
}

/** The picture type from the file's first bytes, or null if it is not PNG, JPEG, WebP or SVG. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/**
 * SVG files can carry scripts. Only plain drawings are accepted: no scripts,
 * event handlers, embedded documents, external references or entities.
 */
export function isSafeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const lower = text.toLowerCase();
  if (/<script|<foreignobject|<iframe|<embed|<object|<!entity|<use[^>]+href\s*=\s*["']?\s*(?!#)|javascript:|data:text\/html/.test(lower)) return false;
  if (/\son[a-z]+\s*=/.test(lower)) return false;
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(png|jpeg|webp);)/.test(lower)) return false;
  return lower.includes("</svg>");
}

export type ImageCheck = { ok: true; contentType: ImageType; extension: string } | { ok: false; error: string };

/** Checks an upload is a picture of an accepted type and size. */
export function checkImage(bytes: Uint8Array, maxBytes = MAX_IMAGE_BYTES): ImageCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "Please choose a picture to upload." };
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `That picture is too big. Please use one under ${Math.round(maxBytes / 1024)} KB.` };
  }
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: "Please upload a PNG, JPEG, WebP or SVG picture." };
  if (type === "image/svg+xml" && !isSafeSvg(bytes)) {
    return { ok: false, error: "That SVG file contains scripts or links, so it cannot be used. Please export a plain SVG or a PNG." };
  }
  return { ok: true, contentType: type, extension: IMAGE_EXTENSIONS[type] };
}
