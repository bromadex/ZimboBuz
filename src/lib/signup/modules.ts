// Which modules to tick at sign-up (P1): the industry's suggestions that the
// chosen plan includes, in the industry's order, within the plan's module
// allowance (modules that do not count, such as the website, always fit).

export interface PlanRules {
  maxModules: number | null;
  modules: string[];
}

export function fitToPlan(wanted: string[], plan: PlanRules, counts: (code: string) => boolean): string[] {
  const out: string[] = [];
  let used = 0;
  for (const code of wanted) {
    if (out.includes(code) || !plan.modules.includes(code)) continue;
    if (counts(code)) {
      if (plan.maxModules !== null && used >= plan.maxModules) continue;
      used += 1;
    }
    out.push(code);
  }
  return out;
}

/** Counted modules ticked, for "2 of 3 modules". */
export function countedModules(ticked: Iterable<string>, counts: (code: string) => boolean): number {
  let n = 0;
  for (const code of ticked) if (counts(code)) n += 1;
  return n;
}
