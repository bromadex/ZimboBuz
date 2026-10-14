import "server-only";
import { randomBytes } from "node:crypto";
import { checkImage } from "@/lib/files";
import { UserError } from "../act";
import type { CompanyContext } from "../company";
import type { Query } from "../data";
import { adapters } from "./services";

// Saves an uploaded picture (logo or website image) for a company: checked by
// content, registered in site_assets as the user (row-level security decides
// who may upload what), then written to file storage under the company id.

export async function saveImage(q: Query, ctx: CompanyContext, upload: FormDataEntryValue | null, kind: "logo" | "image" | "product"): Promise<string> {
  if (!upload || typeof upload === "string" || upload.size === 0) throw new UserError("Please choose a picture to upload.");
  if (upload.size > 2 * 1024 * 1024) throw new UserError("That picture is too big. Please use one under 1024 KB.");
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const check = checkImage(bytes);
  if (!check.ok) throw new UserError(check.error);

  const name = randomBytes(9).toString("hex");
  const path =
    kind === "logo" ? `branding/logo-${name}.${check.extension}` : kind === "product" ? `products/${name}.${check.extension}` : `site/${name}.${check.extension}`;
  const key = `${ctx.company.id}/${path}`;
  await q(
    `insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, file_name, created_by)
     values ($1, $2, $3, $4, $5, $6, auth.uid())`,
    [ctx.company.id, key, kind, check.contentType, bytes.byteLength, upload.name.slice(0, 200) || null],
  );
  const stored = await adapters().storage.put(ctx.company.id, path, bytes, check.contentType);
  if (stored.key !== key) throw new Error("storage key mismatch");
  return key;
}
