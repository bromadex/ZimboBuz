import { formatMoney, type CurrencyCode } from "./money";

// Display helpers shared by ERP screens, the website and printed documents.

export const CURRENCY_LABEL: Record<string, string> = { USD: "USD", ZWG: "ZiG", ZAR: "ZAR" };

export const CURRENCY_OPTIONS = [
  { value: "USD", label: "US dollar (USD)" },
  { value: "ZWG", label: "Zimbabwe Gold (ZiG)" },
  { value: "ZAR", label: "South African rand (ZAR)" },
];

export function currencyLabel(code: string): string {
  return CURRENCY_LABEL[code.trim()] ?? code;
}

/** Money from a database bigint (string) or number. */
export function money(cents: string | number | bigint | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return "—";
  return formatMoney(BigInt(cents), currency.trim() as CurrencyCode);
}

const TZ = "Africa/Harare";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
}

/** Quantities without trailing zeros: "2.500" → "2.5". */
export function formatQuantity(value: string | number): string {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

export const DOC_STATUS: Record<number, { label: string; tone: "draft" | "ok" | "muted" }> = {
  0: { label: "Draft", tone: "draft" },
  1: { label: "Submitted", tone: "ok" },
  2: { label: "Cancelled", tone: "muted" },
};

/** Today's date in Zimbabwe as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}
