// Reads list-view settings (search, filters, sort, page, list or card) from a
// page's query string. Sort keys map to SQL through a fixed list, so nothing
// from the address bar is ever placed into SQL directly.

export type SearchParams = Record<string, string | string[] | undefined>;

export interface SortOption {
  value: string;
  label: string;
  /** SQL ORDER BY expression, written by us. */
  sql: string;
}

export interface ListParams {
  q: string;
  page: number;
  pageSize: number;
  offset: number;
  sort: SortOption;
  view: "list" | "card";
  get(name: string): string | undefined;
}

export function one(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

export function listParams(
  sp: SearchParams,
  { sorts, pageSize = 25, defaultView = "list" }: { sorts: SortOption[]; pageSize?: number; defaultView?: "list" | "card" },
): ListParams {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(sp, "page") ?? "1", 10) || 1));
  const sort = sorts.find((s) => s.value === one(sp, "sort")) ?? sorts[0];
  const view = one(sp, "view") === "card" ? "card" : one(sp, "view") === "list" ? "list" : defaultView;
  return {
    q: (one(sp, "q") ?? "").slice(0, 100),
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    sort,
    view,
    get: (name) => one(sp, name),
  };
}

/** The same query string with some keys changed (undefined removes a key). */
export function withParams(sp: SearchParams, changes: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "success" || k === "error") continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s) params.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** "%term%" for ILIKE, with wildcards in the term escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
