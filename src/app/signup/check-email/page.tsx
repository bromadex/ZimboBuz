import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/signup/check-email">) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email : "your email address";
  const address = typeof sp.address === "string" && /^[a-z0-9.:-]+$/i.test(sp.address) ? sp.address : null;
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight">Check your email</h1>
      <Card className="mt-6">
        <p>
          Your company is set up. We have sent a link to <strong>{email}</strong>: open it to confirm your email address and you will be signed
          in straight away.
        </p>
        {address ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Your ERP is at <strong>{address}</strong>. Nothing in your inbox after a few minutes? Check the spam folder.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
