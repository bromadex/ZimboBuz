import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { EmailLink } from "@/components/email-link";
import { MIN_PASSWORD } from "@/server/adapters/supabase-auth";
import { completeLink } from "../../sign-in/actions";

export const metadata: Metadata = { title: "Signing you in" };

// Where links in sign-in emails land (confirm address, reset password,
// invitation). Supabase must list https://*.zimerp.co.zw/** (and any own
// ERP domains) as allowed redirect addresses.
export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">Your account</h1>
      <Card>
        <EmailLink
          action={completeLink}
          minPassword={MIN_PASSWORD}
          classes={{
            form: "space-y-4",
            field: "block text-sm",
            label: "mb-1 block font-medium",
            input:
              "w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand,#0b6e4f)] dark:border-zinc-700 dark:bg-zinc-950",
            button:
              "inline-flex w-full items-center justify-center rounded-[var(--radius,0.5rem)] bg-[var(--brand,#0b6e4f)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90",
            error: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
            muted: "text-sm text-zinc-600 dark:text-zinc-400",
          }}
        />
      </Card>
    </main>
  );
}
