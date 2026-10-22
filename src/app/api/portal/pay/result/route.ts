import { NextResponse, type NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters/shared";
import { getPool } from "@/server/db";
import { settleLink } from "@/server/invoice-payments";
import { gatewayCredentials } from "@/server/payments";

// Paynow's server-to-server result for a portal invoice payment, verified with the company's key.
export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("link") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad request", { status: 400 });
  const { rows } = await getPool().query<{ company_id: string; currency: string; reference: string }>(
    "select company_id, currency, reference from public.invoice_payment_links where id = $1",
    [id],
  );
  const link = rows[0];
  if (!link) return new NextResponse("not found", { status: 404 });
  const credentials = await gatewayCredentials(link.company_id, link.currency.trim());
  if (!credentials) return new NextResponse("not configured", { status: 409 });
  try {
    const status = getAdapters().payments.paynow.parseResultNotification(credentials, await request.text());
    if (status.reference !== link.reference) return new NextResponse("reference mismatch", { status: 400 });
    if (status.state === "paid") await settleLink(id, status.gatewayReference ?? status.reference);
    return new NextResponse("ok");
  } catch {
    return new NextResponse("invalid", { status: 400 });
  }
}
