"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUserId } from "@/server/auth";
import { seal } from "@/server/secret-box";
import { sessionSecret } from "@/server/session";
import {
  beginTwoStepSetup,
  cancelTwoStepSetup,
  confirmTwoStepSetup,
  disableTwoStep,
  replaceRecoveryCodes,
  TwoStepError,
} from "@/server/two-step";
import { requestProtocol } from "@/server/urls";
import { RECOVERY_COOKIE, RECOVERY_PURPOSE } from "./recovery";

// Two-step sign-in settings for the signed-in user (P3).

const PAGE = "/account/security";

async function me(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  return userId;
}

async function run(work: () => Promise<void>, success: string): Promise<never> {
  let error: string | null = null;
  try {
    await work();
  } catch (e) {
    error = e instanceof TwoStepError ? e.message : "Something went wrong. Please try again.";
    if (!(e instanceof TwoStepError)) console.error(e);
  }
  redirect(`${PAGE}?${new URLSearchParams(error ? { error } : { success })}`);
}

/** Recovery codes are shown once, from a short-lived encrypted cookie, never in the address. */
async function showOnce(codes: string[]) {
  const secure = requestProtocol((await headers()).get("x-forwarded-proto")) === "https";
  (await cookies()).set(RECOVERY_COOKIE, seal(JSON.stringify(codes), sessionSecret(), RECOVERY_PURPOSE), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 10 * 60,
  });
}

const code = (form: FormData) => String(form.get("code") ?? "");

export async function startSetup(): Promise<never> {
  const userId = await me();
  return run(() => beginTwoStepSetup(userId), "Add ZimERP to your authenticator app, then enter the code it shows.");
}

export async function confirmSetup(form: FormData): Promise<never> {
  const userId = await me();
  return run(async () => showOnce(await confirmTwoStepSetup(userId, code(form))), "Two-step sign-in is on.");
}

export async function cancelSetup(): Promise<never> {
  const userId = await me();
  return run(() => cancelTwoStepSetup(userId), "Setup cancelled.");
}

export async function newRecoveryCodes(form: FormData): Promise<never> {
  const userId = await me();
  return run(async () => showOnce(await replaceRecoveryCodes(userId, code(form))), "New recovery codes made. The old ones no longer work.");
}

export async function turnOff(form: FormData): Promise<never> {
  const userId = await me();
  return run(() => disableTwoStep(userId, code(form)), "Two-step sign-in is off.");
}

export async function savedRecoveryCodes(): Promise<never> {
  (await cookies()).delete(RECOVERY_COOKIE);
  redirect(PAGE);
}
