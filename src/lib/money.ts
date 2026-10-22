// Money is stored as integer minor units (cents) with an explicit currency.

export type CurrencyCode = "USD" | "ZWG" | "ZAR";

const LABELS: Record<CurrencyCode, string> = { USD: "USD", ZWG: "ZiG", ZAR: "ZAR" };

/** 2310, "USD" → "USD 23.10"; -150, "ZWG" → "-ZiG 1.50". Thousands separated by commas. */
export function formatMoney(cents: number | bigint, currency: CurrencyCode): string {
  const value = BigInt(cents);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${LABELS[currency]} ${whole}.${fraction}`;
}

/** "23.10" → 2310. Rejects more than two decimal places. */
export function parseMoney(input: string): number {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error(`"${input}" is not a valid amount`);
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return trimmed.startsWith("-") ? -cents : cents;
}
