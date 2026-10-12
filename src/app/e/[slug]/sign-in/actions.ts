"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUserId, devSignIn, endTwoStep, startSession, startTwoStep, twoStepUserId } from "@/server/auth";
import { lookupCompany } from "@/server/company";
import { friendlyError, withUser } from "@/server/data";
import { TwoStepError, twoStepEnabled, verifyTwoStepCode } from "@/server/two-step";
import { safeNextPath } from "@/server/urls";

// Signing in to a company's ERP: email (first step), then the code from an
// authenticator app when the user has two-step sign-in on (second step). The
// session cookie is only issued once both steps pass. Also: accepting an
// invitation to the company.

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function back(params: Record<string, string>): never {
  redirect(`/sign-in?${new URLSearchParams(params)}`);
}

export async function signIn(formData: FormData): Promise<never> {
  const next = safeNextPath(field(formData, "next"));
  let userId: string;
  try {
    userId = await devSignIn(field(formData, "email"));
  } catch (e) {
    back({ error: e instanceof Error && e.message.startsWith("Please") ? e.message : friendlyError(e) });
  }
  if (await twoStepEnabled(userId)) {
    await startTwoStep(userId);
    back({ step: "code", next });
  }
  await endTwoStep();
  await startSession(userId);
  redirect(next);
}

export async function verifyCode(formData: FormData): Promise<never> {
  const next = safeNextPath(field(formData, "next"));
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
