import type { ComponentProps, ReactNode } from "react";

// Shared building blocks for ZimERP screens. Colours, fonts and corners come
// from the company's brand kit through CSS variables set on the ERP shell
// (--brand, --brand-2, --brand-accent, --radius), with ZimERP defaults.

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Notice({ error, success }: { error?: string | string[]; success?: string | string[] }) {
  const text = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const e = text(error);
  const s = text(success);
  if (!e && !s) return null;
  return (
    <p
      role={e ? "alert" : "status"}
      className={`mb-4 rounded-[var(--radius,0.5rem)] border px-4 py-3 text-sm ${
        e
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      }`}
    >
      {e ?? s}
    </p>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {title ? <h2 className="mb-4 text-base font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand,#0b6e4f)] focus:ring-2 focus:ring-[var(--brand,#0b6e4f)]/30 dark:border-zinc-700 dark:bg-zinc-950";

export function Field({ label, hint, className, ...input }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input className={className ?? inputClass} {...input} />
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  options,
  hint,
  ...select
}: { label: string; hint?: string; options: Array<{ value: string; label: string }> } & ComponentProps<"select">) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <select className={inputClass} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function Button({ variant = "primary", className = "", ...props }: { variant?: "primary" | "secondary" } & ComponentProps<"button">) {
  const look =
    variant === "primary"
      ? "bg-[var(--brand,#0b6e4f)] text-white hover:opacity-90"
      : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  return (
    <button
      className={`inline-flex items-center justify-center rounded-[var(--radius,0.5rem)] px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="self-start overflow-x-auto rounded-[var(--radius,0.5rem)] border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-zinc-500">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2 align-top ${className}`}>{children}</td>;
}
