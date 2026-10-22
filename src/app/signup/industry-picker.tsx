"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { countedModules, fitToPlan } from "@/lib/signup/modules";

// P1: choosing an industry ticks the modules it suggests that the chosen plan
// includes, within the plan's module allowance; the owner can then tick or
// untick any of them before creating the company.

export interface PickerIndustry {
  code: string;
  name: string;
  description: string;
  suggestedModules: string[];
  hasStarterItems: boolean;
}
export interface PickerModule {
  code: string;
  name: string;
  hint?: string;
  countsTowardLimit: boolean;
}
export interface PickerPlan {
  code: string;
  name: string;
  priceUsdCents: number;
  maxModules: number | null;
  maxUsers: number | null;
  modules: string[];
}

/** Modules always offered at sign-up; others appear when the industry suggests them. */
const ALWAYS = ["pos", "sales", "inventory", "website", "portal"];

function planLabel(p: PickerPlan): string {
  const price = p.priceUsdCents === 0 ? "free" : `${money(p.priceUsdCents, "USD")} a month`;
  const users = p.maxUsers === null ? "unlimited users" : `${p.maxUsers} user${p.maxUsers === 1 ? "" : "s"}`;
  const mods = p.maxModules === null ? "every module" : `${p.maxModules} module${p.maxModules === 1 ? "" : "s"}`;
  return `${p.name} (${price}, ${users}, ${mods})`;
}

export function IndustryPicker({
  industries,
  modules,
  plans,
  initialIndustry,
  initialPlan,
  initialModules,
}: {
  industries: PickerIndustry[];
  modules: PickerModule[];
  plans: PickerPlan[];
  initialIndustry: string;
  initialPlan: string;
  initialModules: string[] | null;
}) {
  const counts = (code: string) => modules.find((m) => m.code === code)?.countsTowardLimit ?? true;
  const planOf = (code: string) => plans.find((p) => p.code === code) ?? plans[0];
  const industryOf = (code: string) => industries.find((i) => i.code === code);

  const [industry, setIndustry] = useState(initialIndustry);
  const [planCode, setPlanCode] = useState(planOf(initialPlan).code);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(initialModules ?? fitToPlan(industryOf(initialIndustry)?.suggestedModules ?? ["pos"], planOf(initialPlan), counts)),
  );
  const current = industryOf(industry);
  const plan = planOf(planCode);
  const used = countedModules(ticked, counts);
  const full = plan.maxModules !== null && used >= plan.maxModules;

  function chooseIndustry(code: string) {
    setIndustry(code);
    setTicked(new Set(fitToPlan(industryOf(code)?.suggestedModules ?? [], plan, counts)));
  }
  function choosePlan(code: string) {
    setPlanCode(code);
    const next = planOf(code);
    // Keep what still fits; on a bigger plan, add suggestions that now fit.
    const kept = fitToPlan([...ticked], next, counts);
    setTicked(new Set(fitToPlan([...kept, ...(current?.suggestedModules ?? [])], next, counts)));
  }
  function toggle(code: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const shown = modules.filter((m) => ALWAYS.includes(m.code) || current?.suggestedModules.includes(m.code) || ticked.has(m.code));

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind of organisation are you?</legend>
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {industries.map((i) => (
            <label
              key={i.code}
              className="flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 dark:border-zinc-800 dark:has-[:checked]:bg-emerald-950"
            >
              <input type="radio" name="industry" value={i.code} checked={industry === i.code} onChange={() => chooseIndustry(i.code)} className="mt-1" />
              <span>
                <span className="block font-medium">{i.name}</span>
                <span className="block text-xs text-zinc-500">{i.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">
        Plan
        <select
          name="plan"
          value={planCode}
          onChange={(e) => choosePlan(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {planLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          Modules
          {current ? <span className="font-normal text-zinc-500"> — suggested for {current.name.toLowerCase()}; add or remove any</span> : null}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((m) => {
            const suggested = current?.suggestedModules.includes(m.code);
            const onPlan = plan.modules.includes(m.code);
            const checked = ticked.has(m.code) && onPlan;
            const blocked = !onPlan || (!checked && full && m.countsTowardLimit);
            const needs = !onPlan ? plans.find((p) => p.modules.includes(m.code)) : undefined;
            return (
              <label
                key={m.code}
                className={`flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 dark:border-zinc-800 dark:has-[:checked]:bg-emerald-950 ${blocked ? "opacity-60" : ""}`}
              >
                <input type="checkbox" name="modules" value={m.code} checked={checked} disabled={blocked} onChange={() => toggle(m.code)} className="mt-1" />
                <span>
                  <span className="block font-medium">
                    {m.name}
                    {suggested ? (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                        Suggested
                      </span>
                    ) : null}
                  </span>
                  {m.hint ? <span className="block text-xs text-zinc-500">{m.hint}</span> : null}
                  {needs ? <span className="block text-xs text-amber-700 dark:text-amber-400">Needs the {needs.name} plan or higher</span> : null}
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500" aria-live="polite">
          {plan.maxModules === null
            ? `The ${plan.name} plan includes every module. `
            : `${used} of ${plan.maxModules} module${plan.maxModules === 1 ? "" : "s"} on the ${plan.name} plan (the website does not count). `}
          You can change modules at any time.
        </p>
      </fieldset>
      {current?.hasStarterItems ? (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="sample_items" defaultChecked className="mt-1" />
          <span>
            Add a few example {current.code === "church" ? "giving types" : current.code === "ngo" ? "funds" : "items"} to start with
            <span className="block text-xs text-zinc-500">You can rename, re-price or archive them later.</span>
          </span>
        </label>
      ) : null}
    </>
  );
}
