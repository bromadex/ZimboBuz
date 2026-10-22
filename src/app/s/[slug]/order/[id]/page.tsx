import { notFound } from "next/navigation";
import { money } from "@/lib/format";
import { refreshOrder, loadOrder } from "@/server/web-orders";

// After paying online, the visitor lands here; the page checks with Paynow
// and confirms the order once the payment is through.

export const metadata = { title: "Your order" };

export default async function OrderPage({ params, searchParams }: PageProps<"/s/[slug]/order/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const order = await loadOrder(slug, id);
  if (!order) notFound();
  const status = await refreshOrder(order);
  const total = money(order.total_cents, order.currency);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16 text-center">
      {status === "paid" ? (
        <>
          <p className="text-5xl" aria-hidden>
            ✓
          </p>
          <h1 className="mt-2 text-2xl font-bold">Thank you. Your payment of {total} is confirmed.</h1>
          <p className="mt-2 text-zinc-600">Order reference {order.reference}. We will be in touch about delivery or collection.</p>
        </>
      ) : status === "needs_attention" ? (
        <>
          <h1 className="text-2xl font-bold">Payment received, thank you</h1>
          <p className="mt-2 text-zinc-600">Order {order.reference}: something in your order needs checking. The shop will contact you shortly.</p>
        </>
      ) : status === "pending" ? (
        <>
          <h1 className="text-2xl font-bold">Waiting for your payment of {total}</h1>
          <p className="mt-2 text-zinc-600">Order {order.reference}. If you have paid, this page will confirm it in a moment.</p>
          <meta httpEquiv="refresh" content="5" />
          {sp.test ? (
            <form action="/api/shop/simulate" method="post" className="mt-6">
              <input type="hidden" name="order" value={order.id} />
              <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white">
                Pay (test mode)
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">The payment did not go through</h1>
          <p className="mt-2 text-zinc-600">Order {order.reference} was not paid. Nothing has been charged. You can try again from the shop.</p>
        </>
      )}
    </main>
  );
}
