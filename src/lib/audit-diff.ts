// P12: what changed in an audit event, as readable before/after pairs.

type Json = Record<string, unknown> | null | undefined;

/** Columns that change on every save and say nothing to a reader. */
const NOISE = new Set(["updated_at", "created_at", "id", "company_id"]);

export interface Change {
  field: string;
  before: string;
  after: string;
}

export function fieldLabel(key: string): string {
  const label = key.replace(/_cents$/, "").replace(/_id$/, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(showValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Fields that differ (updates), or every filled-in field (inserts). */
export function auditChanges(before: Json, after: Json): Change[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !NOISE.has(k));
  const changes: Change[] = [];
  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];
    if (before && JSON.stringify(b) === JSON.stringify(a)) continue;
    if (!before && (a === null || a === undefined || a === "")) continue;
    changes.push({ field: fieldLabel(key), before: before ? showValue(b) : "", after: showValue(a) });
  }
  return changes;
}
