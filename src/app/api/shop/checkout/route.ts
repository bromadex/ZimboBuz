import { NextResponse, type NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters/shared";
import { friendlyError, withAnon } from "@/server/data";
import { getPool } from "@/server/db";
import { gatewayCredentials } from "@/server/payments";
import { requestProtocol } from "@/server/urls";

// Starts an online store payment: records the order as a draft invoice, then
// hands the visitor to Paynow (the company's own account).
export async function POST(request: NextRequest) {
  let body: { slug?: string; name?: string; email?: string; phone?: string; currency?: string; items?: Array<{ productId: string; quantity: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items.slice(0, 100).map((i) => ({ product_id: i.productId, quantity: Number(i.quantity) })) : [];
  try {
    const order = await withAnon(async (q) =>
      (
        await q<{ r: { order_id: string; reference: string; currency: string; total_cents: number; company_id: string } }>(
          "select public.create_web_order($1, $2, $3, $4, $5, $6) as r",
          [String(body.slug ?? ""), body.name ?? "", body.email ?? "", body.phone ?? "", body.currency ?? "USD", JSON.stringify(items)],
        )
      ).rows[0].r,
    );
    const credentials = await gatewayCredentials(order.company_id, order.currency.trim());
    if (!credentials) {
      await getPool().query("update public.web_orders set status = 'cancelled', problem = 'no gateway' where id = $1", [order.order_id]);
      return NextResponse.json({ error: "This shop cannot take online payments yet. Please send a quote request instead." }, { status: 409 });
    }
    const origin = `${requestProtocol(request.headers.get("x-forwarded-proto"))}://${request.headers.get("host")}`;
    const gateway = getAdapters().payments.paynow;
    const started = await gateway.startWebCheckout(credentials, {
      reference: order.reference,
      amountCents: Number(order.total_cents),
      currency: order.currency.trim() as "USD" | "ZWG" | "ZAR",
      description: `Order ${order.reference}`,
      email: body.email,
      returnUrl: `${origin}/order/${order.order_id}`,
      resultUrl: `${origin}/api/shop/result?order=${order.order_id}`,
    });
    await getPool().query("update public.web_orders set poll_url = $2 where id = $1", [order.order_id, started.pollUrl]);
    // The test gateway has no payment page: go straight to the order page, which offers a test approval.
    const redirectUrl = gateway.name === "fake" ? `${origin}/order/${order.order_id}?test=1` : started.redirectUrl;
    return NextResponse.json({ redirectUrl, orderId: order.order_id, reference: order.reference });
  } catch (e) {
    const message = friendlyError(e);
    return NextResponse.json({ error: message.charAt(0).toUpperCase() + message.slice(1) }, { status: 422 });
  }
}
