"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuthError,
  completeEmailLink,
  currentUserId,
  endTwoStep,
  passwordSignIn,
  requestPasswordReset,
  startSession,
  startTwoStep,
  twoStepUserId,
} from "@/server/auth";
import { platformOrigins } from "@/server/domains";
import { lookupCompany } from "@/server/company";
import { friendlyError, withUser } from "@/server/data";
import { TwoStepError, twoStepEnabled, verifyTwoStepCode } from "@/server/two-step";
import { allow, TOO_MANY } from "@/server/rate-limit";
import { safeNextPath } from "@/server/urls";

// Signing in to a company's ERP: email and password (first step), then the
// code from an authenticator app when the user has two-step sign-in on
// (second step). The session cookie is only issued once both steps pass.
// Also: forgotten passwords, links from sign-in emails, and accepting an
// invitation to the company.

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function back(params: Record<string, string>): never {
  redirect(`/sign-in?${new URLSearchParams(params)}`);
}

export async function signIn(formData: FormData): Promise<never> {
  const next = safeNextPath(field(formData, "next"));
  if (!(await allow("signIn"))) back({ error: TOO_MANY });
  let userId: string;
  try {
    userId = await passwordSignIn(field(formData, "email"), String(formData.get("password") ?? ""));
  } catch (e) {
    back({ error: signInError(e) });
  }
  return finishFirstStep(userId, next);
}

function signInError(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  return e instanceof Error && e.message.startsWith("Please") ? e.message : friendlyError(e);
}

/** After the password (or an email link): ask for the two-step code if it is on, else start the session. */
async function finishFirstStep(userId: string, next: string): Promise<never> {
  if (await twoStepEnabled(userId)) {
    await startTwoStep(userId);
    back({ step: "code", next });
  }
  await endTwoStep();
  await startSession(userId);
  redirect(next);
}

/** "Forgot your password?": Supabase emails a link back to /auth/callback on this address. */
export async function forgotPassword(slug: string, formData: FormData): Promise<never> {
  const email = field(formData, "email");
  if (!(await allow("signIn", "reset"))) redirect(`/forgot-password?${new URLSearchParams({ error: TOO_MANY })}`);
  try {
    await requestPasswordReset(email, `${(await platformOrigins(slug)).erp}/auth/callback`);
  } catch (e) {
    redirect(`/forgot-password?${new URLSearchParams({ error: signInError(e) })}`);
  }
  redirect(
    `/sign-in?${new URLSearchParams({ success: "If that email address has an account, we have sent it a link to choose a new password. It works for one hour." })}`,
  );
}

/** A link from a sign-in email: confirm the address, or set a password after a reset or an invitation. */
export async function completeLink(formData: FormData): Promise<never> {
  if (!(await allow("signIn", "link"))) back({ error: TOO_MANY });
  let userId: string;
  try {
    userId = await completeEmailLink(
      { accessToken: field(formData, "access_token"), tokenHash: field(formData, "token_hash"), type: field(formData, "type") },
      formData.has("password") ? String(formData.get("password")) : null,
    );
  } catch (e) {
    back({ error: signInError(e) });
  }
  return finishFirstStep(userId, "/");
}

export async function verifyCode(formData: FormData): Promise<never> {
  const next = safeNextPath(field(formData, "next"));
  if (!(await allow("signIn", "code"))) back({ step: "code", next, error: TOO_MANY });
  const userId = await twoStepUserId();
  if (!userId) back({ error: "That took too long. Please sign in again." });
  try {
    await verifyTwoStepCode(userId, field(formData, "code"));
  } catch (e) {
    back({ step: "code", next, error: e instanceof TwoStepError ? e.message : "Something went wrong. Please try again." });
  }
  await endTwoStep();
  await startSession(userId);
  redirect(next);
}

export async function cancelSignIn(): Promise<never> {
  await endTwoStep();
  redirect("/sign-in");
}

export async function acceptInvitation(slug: string): Promise<never> {
  const userId = await currentUserId();
  const current = await lookupCompany(slug);
  if (!userId || current.kind !== "invited") redirect("/sign-in");
  let error: string | null = null;
  try {
    await withUser(userId, (q) => q("select public.accept_invitation($1)", [current.companyId]));
  } catch (e) {
    error = friendlyError(e);
  }
  if (error) back({ error });
  revalidatePath("/e/[slug]", "layout");
  redirect(`/?${new URLSearchParams({ success: `Welcome to ${current.companyName}.` })}`);
}
