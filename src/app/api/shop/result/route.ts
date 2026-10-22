import { NextResponse, type NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters/shared";
import { getPool } from "@/server/db";
import { gatewayCredentials } from "@/server/payments";
import { settleOrder } from "@/server/web-orders";

// Paynow's server-to-server result for an online order, verified with the company's key.
export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("order") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad request", { status: 400 });
  const { rows } = await getPool().query<{ company_id: string; currency: string; reference: string }>(
    "select company_id, currency, reference from public.web_orders where id = $1",
    [id],
  );
  const order = rows[0];
  if (!order) return new NextResponse("not found", { status: 404 });
  const credentials = await gatewayCredentials(order.company_id, order.currency.trim());
  if (!credentials) return new NextResponse("not configured", { status: 409 });
  try {
    const status = getAdapters().payments.paynow.parseResultNotification(credentials, await request.text());
    if (status.reference !== order.reference) return new NextResponse("reference mismatch", { status: 400 });
    if (status.state === "paid") await settleOrder(id, status.gatewayReference ?? status.reference);
    return new NextResponse("ok");
  } catch {
    return new NextResponse("invalid", { status: 400 });
  }
}
