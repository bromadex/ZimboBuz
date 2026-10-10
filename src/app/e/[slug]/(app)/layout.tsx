import type { CSSProperties } from "react";
import Link from "next/link";
import { requireCompany, type Branding } from "@/server/company";
import { signOut } from "../actions";

// The ERP shell: navigation filtered by what the user may do, and the
// company's brand kit applied through CSS variables (P20).

const FONTS: Record<Branding["fontPair"], string> = {
  modern: "var(--font-geist-sans), system-ui, sans-serif",
  classic: "Georgia, 'Times New Roman', serif",
  friendly: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  technical: "var(--font-geist-mono), ui-monospace, monospace",
};
const RADII: Record<Branding["cornerStyle"], string> = { square: "0", rounded: "0.5rem", pill: "1rem" };

const NAV: Array<{ href: string; label: string; permission?: string }> = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products", permission: "core.products.view" },
  { href: "/customers", label: "Customers", permission: "core.customers.view" },
  { href: "/settings/rates", label: "Exchange rates" },
  { href: "/settings/modules", label: "Modules and features", permission: "admin.modules.manage" },
  { href: "/settings/branding", label: "Brand kit", permission: "admin.branding.edit" },
];

const STATUS_NOTICE: Record<string, string> = {
  grace: "Your subscription payment is overdue. Everything still works for now; please pay to avoid interruption.",
  read_only: "Your subscription has lapsed, so this company is read-only. You can still view and export your records.",
  suspended: "This company is suspended. Please contact ZimERP support.",
};

export default async function ErpLayout({ children, params }: LayoutProps<"/e/[slug]">) {
  const { slug } = await params;
  const ctx = await requireCompany(slug);
  const { branding } = ctx;
  const style = {
    "--brand": branding.primaryColor,
    "--brand-2": branding.secondaryColor,
    "--brand-accent": branding.accentColor,
    "--radius": RADII[branding.cornerStyle],
    fontFamily: FONTS[branding.fontPair],
  } as CSSProperties;
  const theme = branding.themeMode === "system" ? "" : branding.themeMode === "dark" ? "dark bg-zinc-950 text-zinc-100" : "bg-white text-zinc-900";

  return (
    <div style={style} className={`flex min-h-screen flex-1 flex-col md:flex-row ${theme}`} data-theme={branding.themeMode}>
      <aside className="border-b border-zinc-200 bg-zinc-50 md:w-60 md:shrink-0 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="flex size-9 items-center justify-center rounded-[var(--radius)] bg-[var(--brand)] font-bold text-white" aria-hidden>
            {ctx.company.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{ctx.company.name}</p>
            <p className="truncate text-xs text-zinc-500">
              {ctx.roleName} · {ctx.company.planName} plan
            </p>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
          {NAV.filter((item) => !item.permission || ctx.permissions.has(item.permission)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-[var(--radius)] px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="px-4 pb-4">
          <p className="mb-1 truncate text-xs text-zinc-500">{ctx.userEmail}</p>
          <button type="submit" className="text-xs font-semibold text-zinc-600 underline dark:text-zinc-400">
            Sign out
          </button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        {STATUS_NOTICE[ctx.company.status] ? (
          <p className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {STATUS_NOTICE[ctx.company.status]}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
