import type { NextRequest } from "next/server";
import { isValidKey } from "@/server/adapters/storage";
import { withAnon } from "@/server/web/anon";
import { adapters } from "@/server/web/services";

// Serves public files only (logos, website images): a file is served when it
// is registered in site_assets and not archived (public.public_asset), never
// just because it exists in storage.

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/files/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!isValidKey(key)) return notFound();

  const asset = await withAnon(
    async (q) => (await q<{ content_type: string }>("select content_type from public.public_asset($1)", [key])).rows[0],
  );
  if (!asset) return notFound();
  const file = await adapters().storage.get(key);
  if (!file) return notFound();

  return new Response(Buffer.from(file.body), {
    headers: {
      "content-type": asset.content_type,
      "content-length": String(file.body.byteLength),
      // Keys are unique per upload, so the content never changes.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // SVGs are pictures, never documents that run scripts.
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
