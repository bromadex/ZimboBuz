import { createAdapters, type Adapters } from "./index";

// One set of adapters per server process, so in-memory fakes (development and
// tests) keep their state between requests. Kept on globalThis because Next
// bundles pages and route handlers separately, each with its own copy of
// this module.
const KEY = Symbol.for("zimerp.adapters");
type Holder = { [KEY]?: Adapters };

export function getAdapters(): Adapters {
  const g = globalThis as Holder;
  g[KEY] ??= createAdapters();
  return g[KEY];
}
