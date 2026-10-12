"use client";

import { startTransition, useActionState, useState } from "react";
import { COLUMN_LABELS, type ImportKind, type ImportPreview } from "@/lib/import";

// The two steps of the import screen: choose and check a file, then import it.

const KIND_LABEL: Record<ImportKind, { one: string; many: string }> = {
  products: { one: "product", many: "products" },
  customers: { one: "customer", many: "customers" },
};

const box = "rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const input =
  "w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const primary =
  "inline-flex items-center justify-center rounded-[var(--radius,0.5rem)] bg-[var(--brand,#0b6e4f)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50";

export function ImportForm({
  kinds,
  locations,
  defaultLocation,
  preview,
  run,
}: {
  kinds: ImportKind[];
  locations: Array<{ value: string; label: string }>;
  defaultLocation: string;
  preview: (previous: ImportPreview | null, formData: FormData) => Promise<ImportPreview>;
  run: (formData: FormData) => Promise<never>;
}) {
  const [state, check, checking] = useActionState(preview, null);
  const [kind, setKind] = useState<ImportKind>(state?.kind ?? kinds[0]);
  const result = state?.check ?? null;
  const ready = result && result.fileErrors.length === 0 && result.errorRows === 0 && result.rows.length > 0;
  const problems = result?.rows.filter((r) => r.errors.length) ?? [];
  const opening = result?.kind === "products" && result.rows.some((r) => (r.value as { openingQty?: string | null } | null)?.openingQty);
  const label = KIND_LABEL[state?.kind ?? kind];

  return (
    <div className="space-y-6">
      <section className={box}>
        <h2 className="mb-4 text-base font-semibold">1. Choose a file</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            // Submitted by hand so the form keeps the chosen file and pasted rows for another check.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => check(data));
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-medium">What are you importing?</legend>
            <div className="flex flex-wrap gap-4">
              {kinds.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  {k === "products" ? "Products" : "Customers"}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Use a CSV file (in Excel or Google Sheets: Save as or Download as CSV). The first row names the columns.{" "}
            <a href={`/settings/import/template?type=${kind}`} className="font-semibold text-[var(--brand,#0b6e4f)] underline">
              Download the {KIND_LABEL[kind].many} template
            </a>
            .
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">CSV file</span>
            <input type="file" name="file" accept=".csv,text/csv,text/plain" className={`${input} file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1 dark:file:bg-zinc-800`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Or paste the rows</span>
            <textarea name="pasted" rows={5} placeholder={kind === "products" ? "code,name,price\nCEM-50,Cement 50kg,12.50" : "name,phone,email\nTendai Moyo,077 123 4567,"} className={`${input} font-mono text-xs`} />
          </label>
          {kind === "products" && locations.length ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Opening stock goes into</span>
              <select name="location_id" defaultValue={state?.location || defaultLocation} className={input}>
                {locations.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-zinc-500">Only used for rows with an opening quantity.</span>
            </label>
          ) : null}
          <button type="submit" className={primary} disabled={checking}>
            {checking ? "Checking…" : "Check the file"}
          </button>
        </form>
      </section>

      {state?.error ? (
        <p role="alert" className="rounded-[var(--radius,0.5rem)] border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      ) : null}

      {result ? (
        <section className={box} aria-live="polite">
          <h2 className="mb-2 text-base font-semibold">2. Check and import</h2>
          {result.fileErrors.length ? (
            <ul role="alert" className="mb-4 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-400">
              {result.fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm">
              {result.rows.length} {result.rows.length === 1 ? label.one : label.many} found.{" "}
              {result.errorRows ? (
                <strong className="text-red-700 dark:text-red-400">
                  {result.errorRows} {result.errorRows === 1 ? "row has" : "rows have"} problems. Fix them in your file and check it again; nothing is imported until every row is right.
                </strong>
              ) : (
                <strong className="text-emerald-700 dark:text-emerald-400">Every row is ready to import.</strong>
              )}
            </p>
          )}
          {result.ignored.length ? (
            <p className="mb-4 text-xs text-zinc-500">These columns are not used and will be ignored: {result.ignored.join(", ")}.</p>
          ) : null}

          {problems.length ? (
            <div className="mb-4 overflow-x-auto rounded-[var(--radius,0.5rem)] border border-red-200 dark:border-red-900">
              <table className="w-full text-left text-sm">
                <thead className="bg-red-50 text-xs uppercase tracking-wide text-red-800 dark:bg-red-950 dark:text-red-200">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Problems</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100 dark:divide-red-900">
                  {problems.slice(0, 200).map((r) => (
                    <tr key={r.row}>
                      <td className="px-3 py-2 align-top tabular-nums">{r.row}</td>
                      <td className="px-3 py-2">
                        <span className="block text-xs text-zinc-500">{r.cells.name || r.cells.sku || r.cells.company || ""}</span>
                        <ul className="list-disc pl-4">
                          {r.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {problems.length > 200 ? <p className="px-3 py-2 text-xs text-zinc-500">And {problems.length - 200} more rows with problems.</p> : null}
            </div>
          ) : null}

          {result.rows.length && !result.fileErrors.length ? (
            <details className="mb-4" open={!problems.length}>
              <summary className="cursor-pointer text-sm font-medium">Preview of the first {Math.min(20, result.rows.length)} rows</summary>
              <div className="mt-2 overflow-x-auto rounded-[var(--radius,0.5rem)] border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      {result.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2">
                          {COLUMN_LABELS[c] ?? c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {result.rows.slice(0, 20).map((r) => (
                      <tr key={r.row} className={r.errors.length ? "bg-red-50 dark:bg-red-950/40" : undefined}>
                        <td className="px-3 py-1.5 tabular-nums">{r.row}</td>
                        {result.columns.map((c) => (
                          <td key={c} className="whitespace-nowrap px-3 py-1.5">
                            {r.cells[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {ready ? (
            <form action={run}>
              <input type="hidden" name="kind" value={result.kind} />
              <input type="hidden" name="csv" value={state!.csv} />
              <input type="hidden" name="location_id" value={state!.location} />
              <button type="submit" className={primary}>
                Import {result.rows.length} {result.rows.length === 1 ? label.one : label.many}
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Everything is imported together, or nothing is.
                {opening ? " Opening quantities are recorded as stock received at the cost you gave." : ""}
              </p>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
