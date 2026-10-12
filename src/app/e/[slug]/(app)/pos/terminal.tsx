"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { uuid } from "@/lib/uuid";
import { convert, lineAmounts, planTenders, type Currency, type Rates } from "@/lib/pos/math";
import { checkMobilePayment, checkout, simulateMobilePayment, startMobilePayment, type CheckoutRequest, type CheckoutResponse } from "./actions";

// The till (P5, P6): pick items, take payment in any mix of methods and
// currencies, give change. Sales that cannot be sent because the connection
// dropped are kept on this device and sent when it comes back; the server
// accepts each sale once (by its reference), so retrying is always safe.

export interface PosProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  rateBp: number;
  prices: Partial<Record<Currency, number>>;
  stock: number | null;
}

interface Line {
  productId: string;
  quantity: number;
  discountCents: number;
}

interface TenderRow {
  key: string;
  method: string;
  currency: Currency;
  amount: string;
  reference: string;
  phone: string;
  requestId?: string;
  requestStatus?: string;
  testMode?: boolean;
}

const METHODS: Array<[string, string]> = [
  ["cash", "Cash"],
  ["ecocash", "EcoCash"],
  ["onemoney", "OneMoney"],
  ["innbucks", "InnBucks"],
  ["card", "Card"],
  ["bank_transfer", "Bank transfer"],
  ["zipit", "ZIPIT"],
  ["other", "Other"],
];
const MOBILE = new Set(["ecocash", "onemoney", "innbucks"]);
const CURRENCIES: Currency[] = ["USD", "ZWG", "ZAR"];
const label = (c: string) => (c === "ZWG" ? "ZiG" : c);
const fmt = (cents: number, c: Currency) => formatMoney(cents, c);

function cents(value: string): number | null {
  const t = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

type Queued = { request: CheckoutRequest; queuedAt: string; summary: string };

export function PosTerminal({
  slug,
  sessionId,
  baseCurrency,
  inclusive,
  rates,
  products,
  customers,
  canDiscount,
  canOnAccount,
  canChangeAsCredit,
  mobileCurrencies,
}: {
  slug: string;
  sessionId: string;
  baseCurrency: Currency;
  inclusive: boolean;
  rates: Rates;
  products: PosProduct[];
  customers: Array<{ id: string; name: string; phone: string | null }>;
  canDiscount: boolean;
  canOnAccount: boolean;
  canChangeAsCredit: boolean;
  mobileCurrencies: Currency[];
}) {
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [currency, setCurrency] = useState<Currency>(baseCurrency);
  const [customerId, setCustomerId] = useState<string>("");
  const [tenders, setTenders] = useState<TenderRow[]>([newTender(baseCurrency)]);
  const [changeAsCredit, setChangeAsCredit] = useState(false);
  const [onAccount, setOnAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CheckoutResponse, { ok: true }> | { offline: true; summary: string } | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [refused, setRefused] = useState<string[]>([]);
  const clientRef = useRef<string>(uuid());
  const searchRef = useRef<HTMLInputElement>(null);
  const queueKey = `zimerp-till-queue-${slug}`;

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ---- offline queue ----
  const loadQueue = useCallback((): Queued[] => {
    try {
      return JSON.parse(localStorage.getItem(queueKey) ?? "[]") as Queued[];
    } catch {
      return [];
    }
  }, [queueKey]);
  const saveQueue = useCallback(
    (q: Queued[]) => {
      try {
        localStorage.setItem(queueKey, JSON.stringify(q));
      } catch {
        /* storage full or blocked: the sale stays in memory */
      }
      setQueue(q);
    },
    [queueKey],
  );
  const flush = useCallback(async () => {
    let pending = loadQueue();
    for (const item of [...pending]) {
      let res: CheckoutResponse;
      try {
        res = await checkout(slug, item.request);
      } catch {
        break; // still offline
      }
      pending = pending.filter((p) => p.request.clientRef !== item.request.clientRef);
      saveQueue(pending);
      if (!res.ok) setRefused((r) => [...r, `${item.summary}: ${res.error}`]);
    }
  }, [loadQueue, saveQueue, slug]);
  useEffect(() => {
    // Read what is waiting on this device after the first paint, then send it.
    const first = window.setTimeout(() => {
      setQueue(loadQueue());
      void flush();
    }, 0);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void flush(), 20000);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [flush, loadQueue]);

  // ---- totals ----
  const priced = lines.map((l) => {
    const p = byId.get(l.productId)!;
    const unit = p.prices[currency] ?? null;
    const amounts = unit === null ? null : lineAmounts(l.quantity, unit, l.discountCents, p.rateBp, inclusive);
    return { line: l, product: p, unit, amounts };
  });
  const missingPrice = priced.find((p) => p.unit === null);
  const total = priced.reduce((s, p) => s + (p.amounts?.total ?? 0), 0);
  const tax = priced.reduce((s, p) => s + (p.amounts?.tax ?? 0), 0);
  const tenderList = tenders
    .map((t) => ({ method: t.method, currency: t.currency, amountCents: cents(t.amount) ?? 0 }))
    .filter((t) => t.amountCents > 0);
  const plan = planTenders(total, currency, tenderList, rates);
  const mobileUnconfirmed = tenders.some((t) => MOBILE.has(t.method) && mobileCurrencies.includes(t.currency) && (cents(t.amount) ?? 0) > 0 && t.requestStatus !== "paid");

  // ---- cart ----
  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products.slice(0, 60);
    return products
      .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").includes(term))
      .slice(0, 60);
  }, [products, search]);

  function add(productId: string) {
    setDone(null);
    setError(null);
    setLines((ls) => {
      const found = ls.find((l) => l.productId === productId);
      return found ? ls.map((l) => (l === found ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { productId, quantity: 1, discountCents: 0 }];
    });
  }
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = search.trim();
    const exact = products.find((p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase()) ?? (results.length === 1 ? results[0] : undefined);
    if (exact) {
      add(exact.id);
      setSearch("");
    }
  }
  function setQty(productId: string, quantity: number) {
    setLines((ls) => (quantity <= 0 ? ls.filter((l) => l.productId !== productId) : ls.map((l) => (l.productId === productId ? { ...l, quantity } : l))));
  }
  function updateTender(key: string, change: Partial<TenderRow>) {
    setTenders((ts) => ts.map((t) => (t.key === key ? { ...t, ...change, ...(change.amount !== undefined || change.currency || change.method ? { requestId: undefined, requestStatus: undefined } : {}) } : t)));
  }
  function exact(t: TenderRow) {
    const others = tenders.filter((o) => o.key !== t.key).map((o) => ({ method: o.method, currency: o.currency, amountCents: cents(o.amount) ?? 0 }));
    const left = planTenders(total, currency, others, rates).remainingCents;
    if (left <= 0) return;
    const inTender = t.currency === currency ? left : Math.ceil((left * (rates[t.currency] ?? 1)) / (rates[currency] ?? 1) - 1e-9);
    updateTender(t.key, { amount: (inTender / 100).toFixed(2) });
  }
  function reset() {
    setLines([]);
    setTenders([newTender(currency)]);
    setCustomerId("");
    setChangeAsCredit(false);
    setOnAccount(false);
    setError(null);
    clientRef.current = uuid();
    searchRef.current?.focus();
  }

  // ---- mobile money ----
  async function requestMobile(t: TenderRow) {
    const amount = cents(t.amount);
    if (!amount) return setError("Enter the mobile money amount first.");
    setError(null);
    updateTender(t.key, { requestStatus: "starting" });
    const r = await startMobilePayment(slug, { sessionId, method: t.method as "ecocash", currency: t.currency, amountCents: amount, phone: t.phone });
    if (!r.ok) {
      setTenders((ts) => ts.map((x) => (x.key === t.key ? { ...x, requestStatus: undefined } : x)));
      return setError(r.error);
    }
    setTenders((ts) => ts.map((x) => (x.key === t.key ? { ...x, requestId: r.requestId, requestStatus: "pending", testMode: r.testMode } : x)));
  }
  useEffect(() => {
    const waiting = tenders.filter((t) => t.requestId && t.requestStatus === "pending");
    if (waiting.length === 0) return;
    const timer = window.setInterval(async () => {
      for (const t of waiting) {
        const s = await checkMobilePayment(slug, t.requestId!).catch(() => ({ status: "pending" }));
        if (s.status !== "pending") setTenders((ts) => ts.map((x) => (x.requestId === t.requestId ? { ...x, requestStatus: s.status } : x)));
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [tenders, slug]);

  // ---- pay ----
  async function pay() {
    setError(null);
    if (lines.length === 0) return setError("Add something to the sale first.");
    if (missingPrice) return setError(`${missingPrice.product.name} has no price in ${label(currency)}. Set an exchange rate or a price.`);
    if (plan.problems.length) return setError(plan.problems[0]);
    if (plan.remainingCents > 0 && !onAccount) return setError(`Still to pay: ${fmt(plan.remainingCents, currency)}.`);
    if (mobileUnconfirmed) return setError("Wait for the mobile money payment to be confirmed.");
    const request: CheckoutRequest = {
      sessionId,
      clientRef: clientRef.current,
      customerId: customerId || null,
      currency,
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, discountCents: l.discountCents })),
      tenders: tenders
        .filter((t) => (cents(t.amount) ?? 0) > 0)
        .map((t) => ({ method: t.method, currency: t.currency, amountCents: cents(t.amount)!, reference: t.reference || undefined, paymentRequestId: t.requestId })),
      changeAsCredit,
      onAccount,
    };
    setBusy(true);
    let res: CheckoutResponse;
    try {
      res = await checkout(slug, request);
    } catch {
      const summary = `${fmt(total, currency)} sale at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      saveQueue([...loadQueue(), { request, queuedAt: new Date().toISOString(), summary }]);
      setBusy(false);
      setDone({ offline: true, summary });
      reset();
      return;
    }
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(res);
    reset();
  }

  const customer = customers.find((c) => c.id === customerId);
  const input = "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <section aria-label="Products" className="min-w-0">
        <input
          ref={searchRef}
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search or scan a barcode, then press Enter"
          aria-label="Search products"
          className="mb-3 w-full rounded-[var(--radius)] border border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => add(p.id)}
                className="flex h-full w-full flex-col items-start rounded-[var(--radius)] border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:border-[var(--brand)] active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="line-clamp-2 text-sm font-semibold">{p.name}</span>
                <span className="font-mono text-xs text-zinc-500">{p.sku}</span>
                <span className="mt-auto pt-2 text-sm tabular-nums">{p.prices[currency] !== undefined ? fmt(p.prices[currency]!, currency) : "No price"}</span>
                {p.stock !== null ? <span className={`text-xs ${p.stock <= 0 ? "text-red-600" : "text-zinc-500"}`}>{p.stock} in stock</span> : null}
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="col-span-full py-8 text-center text-sm text-zinc-500">No products match.</li> : null}
        </ul>
      </section>

      <section aria-label="Sale" className="space-y-3 rounded-[var(--radius)] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:sticky lg:top-4 lg:self-start">
        {queue.length ? (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {queue.length} sale{queue.length === 1 ? "" : "s"} waiting to be sent. They will go when the connection is back.
          </p>
        ) : null}
        {refused.map((r) => (
          <p key={r} role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-800">
            Refused when sent: {r}
          </p>
        ))}
        {done ? (
          "offline" in done ? (
            <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              No connection. The {done.summary} is saved on this device and will be sent automatically.
            </div>
          ) : (
            <div role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <p className="font-semibold">
                Sale {done.number} done: {fmt(done.totalCents, done.currency as Currency)}
              </p>
              {done.change.map((c) => (
                <p key={c.currency} className="text-lg font-bold">
                  Change: {fmt(c.cents, c.currency as Currency)}
                </p>
              ))}
              {done.onAccountCents ? <p>On the customer&apos;s account: {fmt(done.onAccountCents, done.currency as Currency)}</p> : null}
              <a className="underline" href={`/print/invoices/${done.invoiceId}`} target="_blank" rel="noreferrer">
                Print receipt
              </a>
            </div>
          )
        ) : null}

        <div className="flex gap-2">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer" className={`${input} min-w-0 flex-1`}>
            <option value="">Walk-in customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` (${c.phone})` : ""}
              </option>
            ))}
          </select>
          <select
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as Currency);
              setTenders([newTender(e.target.value as Currency)]);
            }}
            aria-label="Sale currency"
            className={input}
          >
            {CURRENCIES.filter((c) => c === baseCurrency || rates[c]).map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>

        <ul className="max-h-72 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800" aria-label="Items in this sale">
          {priced.map(({ line, product, amounts }) => (
            <li key={line.productId} className="py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{product.name}</span>
                <span className="tabular-nums">{amounts ? fmt(amounts.total, currency) : "No price"}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" aria-label={`One less ${product.name}`} onClick={() => setQty(line.productId, line.quantity - 1)} className="size-7 rounded border border-zinc-300 dark:border-zinc-700">
                  −
                </button>
                <input
                  value={line.quantity}
                  inputMode="decimal"
                  aria-label={`Quantity of ${product.name}`}
                  onChange={(e) => setQty(line.productId, Number(e.target.value) || 0)}
                  className={`${input} w-16 text-center`}
                />
                <button type="button" aria-label={`One more ${product.name}`} onClick={() => setQty(line.productId, line.quantity + 1)} className="size-7 rounded border border-zinc-300 dark:border-zinc-700">
                  +
                </button>
                {canDiscount ? (
                  <input
                    placeholder="Discount"
                    inputMode="decimal"
                    aria-label={`Discount on ${product.name}`}
                    defaultValue={line.discountCents ? (line.discountCents / 100).toFixed(2) : ""}
                    onBlur={(e) => setLines((ls) => ls.map((l) => (l.productId === line.productId ? { ...l, discountCents: cents(e.target.value) ?? 0 } : l)))}
                    className={`${input} w-24`}
                  />
                ) : null}
                <button type="button" onClick={() => setQty(line.productId, 0)} className="ml-auto text-xs text-zinc-500 hover:text-red-700">
                  Remove
                </button>
              </div>
            </li>
          ))}
          {lines.length === 0 ? <li className="py-6 text-center text-sm text-zinc-500">Tap a product to start a sale.</li> : null}
        </ul>

        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="flex justify-between text-2xl font-bold">
            <span>Total</span>
            <span className="tabular-nums">{fmt(total, currency)}</span>
          </p>
          {tax ? <p className="text-right text-xs text-zinc-500">includes VAT {fmt(tax, currency)}</p> : null}
          <p className="text-right text-xs text-zinc-500">
            {CURRENCIES.filter((c) => c !== currency && rates[c])
              .map((c) => fmt(convert(total, currency, c, rates), c))
              .join(" · ")}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Payment</legend>
          {tenders.map((t) => {
            const mobile = MOBILE.has(t.method) && mobileCurrencies.includes(t.currency);
            return (
              <div key={t.key} className="space-y-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex flex-wrap gap-1">
                  <select value={t.method} onChange={(e) => updateTender(t.key, { method: e.target.value })} aria-label="Payment method" className={input}>
                    {METHODS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <select value={t.currency} onChange={(e) => updateTender(t.key, { currency: e.target.value as Currency })} aria-label="Payment currency" className={input}>
                    {CURRENCIES.filter((c) => c === baseCurrency || rates[c]).map((c) => (
                      <option key={c} value={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                  <input value={t.amount} onChange={(e) => updateTender(t.key, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label="Amount paid" className={`${input} w-24 min-w-0 flex-1`} />
                  <button type="button" onClick={() => exact(t)} className="rounded-md border border-zinc-300 px-2 text-xs font-semibold dark:border-zinc-700">
                    Exact
                  </button>
                  {tenders.length > 1 ? (
                    <button type="button" aria-label="Remove this payment" onClick={() => setTenders((ts) => ts.filter((x) => x.key !== t.key))} className="px-1 text-zinc-500">
                      ×
                    </button>
                  ) : null}
                </div>
                {mobile ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <input value={t.phone} onChange={(e) => updateTender(t.key, { phone: e.target.value })} placeholder="Customer's number" aria-label="Mobile number" inputMode="tel" className={`${input} min-w-0 flex-1`} />
                    {t.requestStatus === "paid" ? (
                      <span className="text-sm font-semibold text-emerald-700">Confirmed ✓</span>
                    ) : t.requestStatus === "pending" || t.requestStatus === "starting" ? (
                      <>
                        <span className="text-xs text-zinc-600">Waiting for the customer to approve…</span>
                        {t.testMode && t.requestId ? (
                          <button
                            type="button"
                            className="text-xs underline"
                            onClick={async () => {
                              const s = await simulateMobilePayment(slug, t.requestId!);
                              setTenders((ts) => ts.map((x) => (x.key === t.key ? { ...x, requestStatus: s.status } : x)));
                            }}
                          >
                            Approve (test mode)
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <button type="button" onClick={() => requestMobile(t)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {t.requestStatus === "failed" || t.requestStatus === "cancelled" ? "Not paid. Try again" : "Send payment request"}
                      </button>
                    )}
                  </div>
                ) : t.method !== "cash" ? (
                  <input value={t.reference} onChange={(e) => updateTender(t.key, { reference: e.target.value })} placeholder="Reference (optional)" aria-label="Payment reference" className={`${input} w-full`} />
                ) : null}
              </div>
            );
          })}
          <button type="button" onClick={() => setTenders((ts) => [...ts, newTender(currency)])} className="text-sm font-semibold text-[var(--brand)] underline">
            Split payment: add another
          </button>
        </fieldset>

        <div className="space-y-1 text-sm">
          {plan.remainingCents > 0 && total > 0 ? <p className="font-semibold text-red-700">Still to pay: {fmt(plan.remainingCents, currency)}</p> : null}
          {plan.change.map((c) => (
            <p key={c.currency} className="text-lg font-bold">
              Change: {fmt(c.cents, c.currency)}
            </p>
          ))}
          {canChangeAsCredit && plan.change.length && customer ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={changeAsCredit} onChange={(e) => setChangeAsCredit(e.target.checked)} />
              Keep the change as {customer.name}&apos;s credit
            </label>
          ) : null}
          {canOnAccount && customer && plan.remainingCents > 0 ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onAccount} onChange={(e) => setOnAccount(e.target.checked)} />
              Put the rest on {customer.name}&apos;s account
            </label>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={pay}
          disabled={busy || lines.length === 0}
          className="w-full rounded-[var(--radius)] bg-[var(--brand)] px-4 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : `Complete sale ${total ? fmt(total, currency) : ""}`}
        </button>
        {lines.length ? (
          <button type="button" onClick={reset} className="w-full text-sm text-zinc-500 underline">
            Clear sale
          </button>
        ) : null}
      </section>
    </div>
  );
}

function newTender(currency: Currency): TenderRow {
  return { key: Math.random().toString(36).slice(2), method: "cash", currency, amount: "", reference: "", phone: "" };
}
