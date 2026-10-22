import Link from "next/link";
import type { ReactNode } from "react";
import { withParams, type ListParams, type SearchParams } from "@/lib/list-params";

// List and card views for every record list (P16): search, filters, sorting,
// paging and a list/card switch, all kept in the address so views can be
// bookmarked and shared.

export interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface Filter {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export function ListView<T extends { id: string }>({
  path,
  sp,
  params,
  total,
  rows,
  columns,
  card,
  href,
  filters = [],
  sorts = [],
  empty = "Nothing here yet.",
  searchLabel = "Search",
}: {
  path: string;
  sp: SearchParams;
  params: ListParams;
  total: number;
  rows: T[];
  columns: Column<T>[];
  card?: (row: T) => ReactNode;
  href?: (row: T) => string;
  filters?: Filter[];
  sorts?: Array<{ value: string; label: string }>;
  empty?: string;
  searchLabel?: string;
}) {
  const view = card ? params.view : "list";
  const first = total === 0 ? 0 : params.offset + 1;
  const last = Math.min(total, params.offset + rows.length);
  const pages = Math.max(1, Math.ceil(total / params.pageSize));

  return (
    <div className="space-y-3">
      <form method="get" action={path} className="flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-48 flex-1 text-sm">
          <span className="sr-only">{searchLabel}</span>
          <input
            name="q"
            defaultValue={params.q}
            placeholder={searchLabel}
            className="w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        {filters.map((f) => (
          <label key={f.name} className="text-sm">
            <span className="sr-only">{f.label}</span>
            <select
              name={f.name}
              defaultValue={params.get(f.name) ?? ""}
              className="rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">{f.label}: all</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {sorts.length > 1 ? (
          <label className="text-sm">
            <span className="sr-only">Sort by</span>
            <select
              name="sort"
              defaultValue={params.sort.value}
              className="rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {sorts.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {card ? <input type="hidden" name="view" value={view} /> : null}
        <button
          type="submit"
          className="rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900"
        >
          Apply
        </button>
        {card ? (
          <div className="ml-auto flex overflow-hidden rounded-[var(--radius,0.5rem)] border border-zinc-300 text-sm dark:border-zinc-700" aria-label="View">
            {(["list", "card"] as const).map((v) => (
              <Link
                key={v}
                href={`${path}${withParams(sp, { view: v, page: undefined })}`}
                aria-current={view === v ? "true" : undefined}
                className={`px-3 py-2 font-medium ${view === v ? "bg-[var(--brand,#0b6e4f)] text-white" : "bg-white dark:bg-zinc-900"}`}
              >
                {v === "list" ? "List" : "Cards"}
              </Link>
            ))}
          </div>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius,0.5rem)] border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {params.q || filters.some((f) => params.get(f.name)) ? "Nothing matches. Try a different search." : empty}
        </p>
      ) : view === "card" && card ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id}>
              {href ? (
                <Link
                  href={href(row)}
                  className="block h-full rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-[var(--brand,#0b6e4f)] dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {card(row)}
                </Link>
              ) : (
                <div className="h-full rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{card(row)}</div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius,0.5rem)] border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={`px-4 py-2 font-semibold ${c.className ?? ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.id} className={href ? "hover:bg-zinc-50 dark:hover:bg-zinc-900" : undefined}>
                  {columns.map((c, i) => (
                    <td key={c.label} className={`px-4 py-2 align-top ${c.className ?? ""}`}>
                      {href && i === 0 ? (
                        <Link href={href(row)} className="font-medium text-[var(--brand,#0b6e4f)] hover:underline">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>{total ? `Showing ${first}–${last} of ${total}` : ""}</span>
        {pages > 1 ? (
          <span className="flex gap-2">
            {params.page > 1 ? (
              <Link className="underline" href={`${path}${withParams(sp, { page: params.page - 1 })}`}>
                Previous
              </Link>
            ) : null}
            <span>
              Page {params.page} of {pages}
            </span>
            {params.page < pages ? (
              <Link className="underline" href={`${path}${withParams(sp, { page: params.page + 1 })}`}>
                Next
              </Link>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
