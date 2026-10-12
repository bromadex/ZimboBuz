import { createAdapters, type Adapters } from "./index";

// One set of adapters per server process, so in-memory fakes (development and
// tests) keep their state between requests.
let shared: Adapters | undefined;

export function getAdapters(): Adapters {
  shared ??= createAdapters();
  return shared;
}
