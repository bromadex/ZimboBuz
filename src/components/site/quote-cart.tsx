"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { BuyForm } from "@/components/shop/buy-form";
import type { EnquiryState } from "./enquiry-state";

// "Add to quote" cart (P9): kept in the visitor's browser (localStorage, one
// list per company site) and sent through public.submit_website_enquiry,
// which creates a lead and a draft quote in the ERP.
// When the shop takes online payments (feature website.buy and a Paynow
// account for the currency), priced baskets can also be paid straight away.

export interface CartItem {
  id: string;
  name: string;
  priceCents: string | null;
  currency: string;
  quantity: number;
}

const EVENT = "zs-cart-change";
const key = (slug: string) => `zimerp-quote:${slug}`;
const EMPTY: CartItem[] = [];
const snapshots = new Map<string, { raw: string | null; items: CartItem[] }>();

function read(slug: string): CartItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(slug));
  } catch {
    return EMPTY;
  }
  const cached = snapshots.get(slug);
  if (cached && cached.raw === raw) return cached.items;
  let items: CartItem[] = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as CartItem[]) : [];
    items = Array.isArray(parsed)
      ? parsed
          .filter((i) => i && typeof i.id === "string" && /^[0-9a-f-]{36}$/i.test(i.id))
          .map((i) => ({ ...i, quantity: Math.min(9999, Math.max(1, Math.round(Number(i.quantity) || 1))) }))
          .slice(0, 100)
      : EMPTY;
  } catch {
    items = EMPTY;
  }
  snapshots.set(slug, { raw, items });
  return items;
}

function write(slug: string, items: CartItem[]) {
  try {
    if (items.length) window.localStorage.setItem(key(slug), JSON.stringify(items));
    else window.localStorage.removeItem(key(slug));
  } catch {
    // storage blocked: the cart simply does not persist
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function useCart(slug: string): CartItem[] {
  return useSyncExternalStore(subscribe, () => read(slug), () => EMPTY);
}

function price(cents: string | number | null, currency: string): string {
  if (cents === null) return "Price on request";
  return formatMoney(BigInt(cents), currency as CurrencyCode);
}

export function AddToQuoteButton({
  slug,
  product,
  quantityInput = false,
  className = "zs-btn zs-btn-small",
}: {
  slug: string;
  product: Omit<CartItem, "quantity">;
  quantityInput?: boolean;
  className?: string;
}) {
  const items = useCart(slug);
  const inCart = items.find((i) => i.id === product.id);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1800);
    return () => clearTimeout(t);
  }, [added]);

  const add = () => {
    const current = read(slug);
    const existing = current.find((i) => i.id === product.id);
    const next = existing
      ? current.map((i) => (i.id === product.id ? { ...i, quantity: Math.min(9999, i.quantity + quantity) } : i))
      : [...current, { ...product, quantity }];
    write(slug, next);
    setAdded(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {quantityInput ? (
        <label className="flex items-center gap-2 text-sm">
          <span>Quantity</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={quantity}
            onChange={(e) => setQuantity(Math.min(9999, Math.max(1, Number(e.target.value) || 1)))}
            className="zs-input"
            style={{ width: "6rem" }}
          />
        </label>
      ) : null}
      <button type="button" onClick={add} className={className} aria-live="polite">
        {added ? "Added ✓" : inCart ? `Add more (${inCart.quantity})` : "Add to quote"}
      </button>
    </div>
  );
}

export function CartLink({ slug }: { slug: string }) {
  const items = useCart(slug);
  const count = items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Link href="/quote" className="zs-cart-link" aria-label={`Your quote, ${count} item${count === 1 ? "" : "s"}`}>
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2h6l1 3H8z" />
        <rect x="4" y="5" width="16" height="17" rx="2" />
        <path d="M8 11h8M8 15h5" />
      </svg>
      <span className="hidden sm:inline">Quote</span>
      {count > 0 ? (
        <span className="zs-cart-count" data-bump key={count}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function QuoteCart({
  slug,
  action,
  buyCurrencies = [],
}: {
  slug: string;
  action: (state: EnquiryState, form: FormData) => Promise<EnquiryState>;
  /** Currencies the shop can take online payment in (empty: quotes only). */
  buyCurrencies?: string[];
}) {
  const items = useCart(slug);
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as EnquiryState);

  useEffect(() => {
    if (state.status === "sent") write(slug, []);
  }, [state, slug]);

  const setQuantity = (id: string, quantity: number) =>
    write(slug, read(slug).map((i) => (i.id === id ? { ...i, quantity: Math.min(9999, Math.max(1, quantity)) } : i)));
  const remove = (id: string) => write(slug, read(slug).filter((i) => i.id !== id));

  if (state.status === "sent") {
    return (
      <div className="zs-card p-6 sm:p-8" role="status">
        <p className="zs-eyebrow">Request sent</p>
        <h2 className="zs-h2">Thank you, we have your request</h2>
        <p className="zs-lead mt-3">
          We will prepare your quote and get back to you soon. Your reference is <strong>{state.reference}</strong>.
        </p>
        <Link href="/shop" className="zs-btn mt-6">
          Keep browsing
        </Link>
      </div>
    );
  }

  const currency = items[0]?.currency;
  const known = items.every((i) => i.priceCents !== null && i.currency === currency);
  const total = known ? items.reduce((sum, i) => sum + BigInt(i.priceCents!) * BigInt(i.quantity), BigInt(0)) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="zs-card p-4 sm:p-6" aria-label="Items">
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <p className="zs-h3">Your quote is empty</p>
            <p className="zs-muted mt-2">Add products from the shop and send us one request for all of them.</p>
            <Link href="/shop" className="zs-btn mt-5">
              Go to the shop
            </Link>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-3" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <Link href={`/shop/${i.id}`} className="zs-product-name">
                    {i.name}
                  </Link>
                  <p className="zs-muted text-sm">{price(i.priceCents, i.currency)} each</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="zs-btn zs-btn-ghost zs-btn-small" aria-label={`Fewer ${i.name}`} onClick={() => setQuantity(i.id, i.quantity - 1)}>
                    −
                  </button>
                  <input
                    aria-label={`Quantity of ${i.name}`}
                    className="zs-input text-center"
                    style={{ width: "4.5rem", padding: "0.45rem" }}
                    type="number"
                    min={1}
                    value={i.quantity}
                    onChange={(e) => setQuantity(i.id, Number(e.target.value) || 1)}
                  />
                  <button type="button" className="zs-btn zs-btn-ghost zs-btn-small" aria-label={`More ${i.name}`} onClick={() => setQuantity(i.id, i.quantity + 1)}>
                    +
                  </button>
                </div>
                <button type="button" className="zs-link text-sm" onClick={() => remove(i.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 ? (
          <p className="mt-4 flex justify-between text-sm">
            <span className="zs-muted">Estimated total</span>
            <strong className="zs-price">{total !== null && currency ? price(total.toString(), currency) : "We will confirm prices"}</strong>
          </p>
        ) : null}
      </section>

      <div className="space-y-6">
      {known && currency && items.length > 0 && buyCurrencies.includes(currency) ? (
        <section className="zs-card p-4 sm:p-6" aria-label="Pay now">
          <h2 className="zs-h3">Buy now</h2>
          <p className="zs-muted mt-1 mb-4 text-sm">Pay {total !== null ? price(total.toString(), currency) : ""} by EcoCash, OneMoney or card.</p>
          <BuyForm
            slug={slug}
            currency={currency}
            items={items.map((i) => ({ productId: i.id, quantity: i.quantity }))}
            onDone={() => write(slug, [])}
            inputClass="zs-input w-full"
            buttonClass="zs-btn zs-btn-block"
          />
        </section>
      ) : null}
      <section className="zs-card p-4 sm:p-6" aria-label="Your details">
        <h2 className="zs-h3">{buyCurrencies.length ? "Or ask for a quote" : "Where should we send your quote?"}</h2>
        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ product_id: i.id, quantity: i.quantity })))} />
          <EnquiryFields />
          {state.status === "error" ? (
            <p className="zs-notice zs-notice-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <button type="submit" className="zs-btn zs-btn-block" disabled={pending || items.length === 0}>
            {pending ? "Sending…" : "Request my quote"}
          </button>
          <p className="zs-muted text-xs">We only use your details to reply to you.</p>
        </form>
      </section>
      </div>
    </div>
  );
}

/** Name, email, phone and message fields, plus a hidden trap for spam robots. */
export function EnquiryFields({ messageLabel = "Anything we should know?", requireMessage = false }: { messageLabel?: string; requireMessage?: boolean }) {
  return (
    <>
      <label className="zs-field">
        <span>Your name</span>
        <input className="zs-input" name="name" required autoComplete="name" maxLength={200} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="zs-field">
          <span>Email</span>
          <input className="zs-input" name="email" type="email" autoComplete="email" maxLength={320} />
        </label>
        <label className="zs-field">
          <span>Phone or WhatsApp</span>
          <input className="zs-input" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </label>
      </div>
      <label className="zs-field">
        <span>{messageLabel}</span>
        <textarea className="zs-input" name="message" rows={4} maxLength={5000} required={requireMessage} />
      </label>
      <div aria-hidden style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Leave this empty <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
    </>
  );
}

export function ContactForm({ action }: { action: (state: EnquiryState, form: FormData) => Promise<EnquiryState> }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as EnquiryState);
  if (state.status === "sent") {
    return (
      <div className="zs-notice zs-notice-ok" role="status">
        <strong>Thank you, your message has been sent.</strong> We will reply soon. Your reference is {state.reference}.
      </div>
    );
  }
  return (
    <form action={formAction} className="relative space-y-4">
      <EnquiryFields messageLabel="Your message" requireMessage />
      {state.status === "error" ? (
        <p className="zs-notice zs-notice-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="zs-btn" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
