import { NextResponse, type NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters/shared";
import { getPool } from "@/server/db";
import { gatewayCredentials, recordRequestStatus } from "@/server/payments";

// Paynow posts the result of each payment here (server to server). The
// message is verified with the company's own integration key before anything
// changes; the request id in the address only says which key to use.
export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("request") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad request", { status: 400 });
  const { rows } = await getPool().query<{ company_id: string; currency: string; reference: string }>(
    "select company_id, currency, reference from public.payment_requests where id = $1",
    [id],
  );
  const req = rows[0];
  if (!req) return new NextResponse("not found", { status: 404 });
  const credentials = await gatewayCredentials(req.company_id, req.currency.trim());
  if (!credentials) return new NextResponse("not configured", { status: 409 });
  try {
    const status = getAdapters().payments.paynow.parseResultNotification(credentials, await request.text());
    if (status.reference !== req.reference) return new NextResponse("reference mismatch", { status: 400 });
    await recordRequestStatus(req.company_id, id, status);
    return new NextResponse("ok");
  } catch {
    return new NextResponse("invalid", { status: 400 });
  }
}
