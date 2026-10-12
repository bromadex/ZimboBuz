"use server";

import { redirect } from "next/navigation";
import { act, text, UserError } from "@/server/act";
import { createAdapters } from "@/server/adapters";
import { toWhatsAppNumber } from "@/server/adapters/messaging";
import { collectSummary, harareDate, summaryText } from "@/server/daily-summary";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { getPool } from "@/server/db";

// P10: daily WhatsApp summary settings.

const PATH = "/settings/notifications";

function phones(form: FormData): string[] {
  const raw = text(form, "phones")
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (raw.length > 5) throw new UserError("Please enter up to 5 phone numbers.");
  for (const p of raw) {
    const digits = toWhatsAppNumber(p);
    if (!/^\d{11,15}$/.test(digits)) throw new UserError(`Please check the phone number ${p}. Use a WhatsApp number like 077 123 4567.`);
  }
  return [...new Set(raw)];
}

export async function saveSummarySettings(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Daily summary settings saved.", async (q, ctx) => {
    const enabled = form.get("enabled") === "on";
    const list = phones(form);
    if (enabled && list.length === 0) throw new UserError("Please enter at least one WhatsApp number.");
    const hour = Number(text(form, "hour"));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new UserError("Please choose a time.");
    await q(
      `insert into public.company_preferences (company_id, daily_summary_enabled, daily_summary_phones, daily_summary_hour)
       values ($1, $2, $3, $4)
       on conflict (company_id) do update set daily_summary_enabled = excluded.daily_summary_enabled,
         daily_summary_phones = excluded.daily_summary_phones, daily_summary_hour = excluded.daily_summary_hour`,
      [ctx.company.id, enabled, list, hour],
    );
  });
}

export async function sendTestSummary(slug: string): Promise<never> {
  const ctx = await requirePermission(slug, "admin.company.edit");
  let result: Record<string, string>;
  try {
    const prefs = await withUser(ctx.userId, async (q) =>
      (await q<{ phones: string[] }>("select daily_summary_phones as phones from public.company_preferences where company_id = $1", [ctx.company.id])).rows[0],
    );
    if (!prefs?.phones.length) throw new UserError("Save at least one WhatsApp number first.");
    // Permission checked above; the figures for this company are read as the server.
    const body = summaryText(await collectSummary(getPool(), ctx.company.id, harareDate(new Date())));
    const adapters = createAdapters();
    for (const to of prefs.phones) await adapters.messaging.sendText({ to, text: `Test: ${body}` });
    const n = `${prefs.phones.length} number${prefs.phones.length === 1 ? "" : "s"}`;
    result = {
      success: adapters.messaging.name === "fake" ? `Test prepared for ${n}. WhatsApp is not connected here, so nothing was delivered.` : `Test sent to ${n}.`,
    };
  } catch (e) {
    result = { error: e instanceof UserError ? e.message : "The test message could not be sent. Please try again later." };
  }
  redirect(`${PATH}?${new URLSearchParams(result)}`);
}
