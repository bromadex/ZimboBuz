import { describe, expect, it } from "vitest";
import { countedModules, fitToPlan } from "./modules";

const counts = (c: string) => c !== "website";

describe("fitToPlan", () => {
  it("keeps the industry's order, drops modules the plan lacks and stops at the allowance", () => {
    const business = { maxModules: 3, modules: ["pos", "sales", "inventory", "website", "portal", "crm"] };
    expect(fitToPlan(["pos", "sales", "inventory", "website", "crm"], business, counts)).toEqual(["pos", "sales", "inventory", "website"]);
    expect(fitToPlan(["mining", "sales"], business, counts)).toEqual(["sales"]);
    expect(fitToPlan(["sales", "sales", "website"], { maxModules: null, modules: ["sales", "website"] }, counts)).toEqual(["sales", "website"]);
    expect(fitToPlan(["pos", "sales", "website"], { maxModules: 1, modules: ["pos", "sales", "website"] }, counts)).toEqual(["pos", "website"]);
  });

  it("counts only modules that count", () => {
    expect(countedModules(["pos", "website", "crm"], counts)).toBe(2);
  });
});
