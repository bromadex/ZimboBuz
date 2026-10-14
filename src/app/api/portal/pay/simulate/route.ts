import { NextResponse, type NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters/shared";
import { getPool } from "@/server/db";

// Test mode only: approve a portal invoice payment with the fake gateway.
export async function POST(request: NextRequest) {
  const gateway = getAdapters().payments.paynow as unknown as { name: string; settle?: (reference: string, state: "paid") => void };
  const form = await request.formData();
  const id = String(form.get("link") ?? "");
  if (gateway.name !== "fake" || !gateway.settle || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("not available", { status: 404 });
  const { rows } = await getPool().query<{ reference: string; invoice_id: string }>("select reference, invoice_id from public.invoice_payment_links where id = $1", [id]);
  if (!rows[0]) return new NextResponse("not found", { status: 404 });
  gateway.settle(rows[0].reference, "paid");
  return NextResponse.redirect(new URL(`/account/invoices/${rows[0].invoice_id}?payment=${id}`, `http://${request.headers.get("host")}`), 303);
}
