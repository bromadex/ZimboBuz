// Till arithmetic, mirroring the database (app.line_amounts and pos_checkout)
// so the till can show totals and change before the sale is sent. The
// database recalculates everything and is always the authority.

export type Currency = "USD" | "ZWG" | "ZAR";

/** Rate per currency: how much of it one unit of the base currency buys (base = 1). */
export type Rates = Partial<Record<Currency, number>>;

export function lineAmounts(quantity: number, unitPriceCents: number, discountCents: number, rateBp: number, inclusive: boolean) {
  const gross = Math.round(quantity * unitPriceCents) - discountCents;
  if (gross < 0) throw new Error("The discount is larger than the line amount.");
  if (inclusive) {
    const net = Math.round((gross * 10000) / (10000 + rateBp));
    return { net, tax: gross - net, total: gross };
  }
  const tax = Math.round((gross * rateBp) / 10000);
  return { net: gross, tax, total: gross + tax };
}

/** Converts minor units between currencies at the given rates (half-up), like app.convert_cents. */
export function convert(cents: number, from: Currency, to: Currency, rates: Rates): number {
  if (from === to) return cents;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) throw new Error(`No exchange rate for ${!rf ? from : to}.`);
  return Math.round((cents / rf) * rt);
}

export interface Tender {
  method: string;
  currency: Currency;
  amountCents: number;
}

export interface TenderPlan {
  /** Still to pay, in the sale currency (0 when fully paid). */
  remainingCents: number;
  /** Change to hand back, per currency (cash only). */
  change: Array<{ currency: Currency; cents: number }>;
  /** Problems that will stop the sale. */
  problems: string[];
}

/**
 * Applies tenders to a total the way pos_checkout does: non-cash first, each
 * tender covers what is left (rounded up in its currency), cash over-payment
 * becomes change in the same currency.
 */
export function planTenders(
  totalCents: number,
  saleCurrency: Currency,
  tenders: Tender[],
  rates: Rates,
  /** Give cash change in this currency instead of the one handed over. */
  changeCurrency?: Currency,
): TenderPlan {
  let remaining = totalCents;
  const change: TenderPlan["change"] = [];
  const problems: string[] = [];
  const ordered = [...tenders].sort((a, b) => Number(a.method === "cash") - Number(b.method === "cash"));
  for (const t of ordered) {
    if (!(t.amountCents > 0)) continue;
    let need = 0;
    if (remaining > 0) {
      if (t.currency === saleCurrency) need = remaining;
      else {
        const rt = rates[t.currency];
        const ri = rates[saleCurrency];
        if (!rt || !ri) {
          problems.push(`Set an exchange rate for ${t.currency} first.`);
          continue;
        }
        need = Math.ceil((remaining * rt) / ri - 1e-9);
      }
    }
    const used = Math.min(t.amountCents, need);
    const left = t.amountCents - used;
    if (left > 0) {
      if (t.method !== "cash") problems.push("Card and mobile money payments cannot be more than the amount due.");
      else if (changeCurrency && changeCurrency !== t.currency) {
        try {
          change.push({ currency: changeCurrency, cents: convert(left, t.currency, changeCurrency, rates) });
        } catch {
          problems.push(`Set an exchange rate for ${changeCurrency} first.`);
        }
      } else change.push({ currency: t.currency, cents: left });
    }
    if (used > 0) {
      const applied = t.currency === saleCurrency ? used : convert(used, t.currency, saleCurrency, rates);
      remaining = Math.max(0, remaining - applied);
      // a payment in another currency that reaches the balance settles it (rounding)
      if (t.currency !== saleCurrency && used === need) remaining = 0;
    }
  }
  return { remainingCents: remaining, change, problems };
}
