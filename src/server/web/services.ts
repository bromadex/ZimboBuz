import "server-only";
import { getAdapters } from "../adapters/shared";
import type { Adapters } from "../adapters";

// The process-wide adapters (see ../adapters/shared.ts).
export function adapters(): Adapters {
  return getAdapters();
}
