"use client";

import { useState } from "react";

// P1: choosing an industry ticks the modules it suggests; the owner can then
// tick or untick any of them before creating the company.

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
  hint: string;
}

export function IndustryPicker({
  industries,
  modules,
  initialIndustry,
  initialModules,
}: {
  industries: PickerIndustry[];
  modules: PickerModule[];
  initialIndustry: string;
  initialModules: string[] | null;
}) {
  const [industry, setIndustry] = useState(initialIndustry);
  const current = industries.find((i) => i.code === industry);
  const [ticked, setTicked] = useState<Set<string>>(new Set(initialModules ?? current?.suggestedModules ?? ["pos"]));

  function choose(code: string) {
    setIndustry(code);
    const next = industries.find((i) => i.code === code);
    if (next) setTicked(new Set(next.suggestedModules));
  }
  function toggle(code: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

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
              <input type="radio" name="industry" value={i.code} checked={industry === i.code} onChange={() => choose(i.code)} className="mt-1" />
              <span>
                <span className="block font-medium">{i.name}</span>
                <span className="block text-xs text-zinc-500">{i.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          Modules{current ? <span className="font-normal text-zinc-500"> — suggested for {current.name.toLowerCase()}; add or remove any</span> : null}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modules.map((m) => {
            const suggested = current?.suggestedModules.includes(m.code);
            return (
              <label
                key={m.code}
                className="flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 dark:border-zinc-800 dark:has-[:checked]:bg-emerald-950"
              >
                <input type="checkbox" name="modules" value={m.code} checked={ticked.has(m.code)} onChange={() => toggle(m.code)} className="mt-1" />
                <span>
                  <span className="block font-medium">
                    {m.name}
                    {suggested ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Suggested</span> : null}
                  </span>
                  <span className="block text-xs text-zinc-500">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">The Starter plan includes one module; the website does not count. You can change modules at any time.</p>
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
