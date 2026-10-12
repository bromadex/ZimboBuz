import "server-only";
import { createAdapters, type Adapters } from "../adapters";

// One set of adapters per server process, so in-memory fakes (development)
// keep their state between requests.
const holder = globalThis as unknown as { __zimerpAdapters?: Adapters };

export function adapters(): Adapters {
  holder.__zimerpAdapters ??= createAdapters();
  return holder.__zimerpAdapters;
}
