import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { createSessionToken, readSessionToken, sessionSecret } from "@/server/session";
import { normaliseHost } from "@/lib/tenancy/host";
import { twoStepEnabled } from "@/server/two-step";
import { requestProtocol } from "@/server/urls";

// Completes sign-up: the platform sends the new owner here with a token bound
// to this host and valid for two minutes; it becomes a normal session cookie.
export async function GET(request: NextRequest) {
  const host = normaliseHost(request.headers.get("host"));
  const session = readSessionToken(request.nextUrl.searchParams.get("token") ?? undefined, sessionSecret(), Date.now(), host);
  // Someone with two-step sign-in on signs in properly, with their code.
  if (session && (await twoStepEnabled(session.userId))) {
    const origin = `${requestProtocol(request.headers.get("x-forwarded-proto"))}://${request.headers.get("host")}`;
    const message = "Your company is ready. Please sign in with your two-step code.";
    return NextResponse.redirect(new URL("/sign-in?success=" + encodeURIComponent(message), origin), 303);
  }
  const protocol = requestProtocol(request.headers.get("x-forwarded-proto"));
  const origin = `${protocol}://${request.headers.get("host")}`;
  const target = new URL(session ? "/" : "/sign-in?error=" + encodeURIComponent("That sign-in link has expired. Please sign in."), origin);
  const response = NextResponse.redirect(target, 303);
  if (session) {
    response.cookies.set(SESSION_COOKIE, createSessionToken(session.userId, sessionSecret()), sessionCookieOptions(protocol));
  }
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
