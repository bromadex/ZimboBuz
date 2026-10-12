"use client";

import { useState } from "react";

// Online checkout for a store basket ("Buy", feature website.buy): the
// visitor gives their details and is taken to Paynow to pay the shop directly.

export function BuyForm({
  slug,
  currency,
  items,
  onDone,
}: {
  slug: string;
  currency: string;
  items: Array<{ productId: string; quantity: number }>;
  onDone?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          currency,
          items,
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone"),
        }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !data.redirectUrl) throw new Error(data.error ?? "Something went wrong. Please try again.");
      onDone?.();
      window.location.assign(data.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const input = "w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
  return (
    <form onSubmit={submit} className="space-y-3">
      <input name="name" required placeholder="Your name" aria-label="Your name" className={input} />
      <input name="email" type="email" required placeholder="Email address (for your receipt)" aria-label="Email address" className={input} />
      <input name="phone" type="tel" placeholder="Phone (optional)" aria-label="Phone" className={input} />
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || items.length === 0} className="w-full rounded-[var(--radius,0.5rem)] bg-[var(--brand,#0b6e4f)] px-4 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? "Taking you to payment…" : "Pay now with EcoCash or card"}
      </button>
      <p className="text-center text-xs text-zinc-500">Payments are handled securely by Paynow.</p>
    </form>
  );
}
