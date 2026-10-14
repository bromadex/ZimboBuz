import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Field, Notice } from "@/components/ui";
import { lookupCompany } from "@/server/company";
import QRCode from "qrcode";
import { open } from "@/server/secret-box";
import { sessionSecret } from "@/server/session";
import { groupSecret } from "@/server/totp";
import { twoStepAvailable, twoStepStatus } from "@/server/two-step";
import {
  cancelSetup,
  confirmSetup,
  newRecoveryCodes,
  savedRecoveryCodes,
  startSetup,
  turnOff,
} from "./actions";
import { RECOVERY_COOKIE, RECOVERY_PURPOSE } from "./recovery";

// P3: two-step sign-in for the signed-in user. Outside the ERP shell, so a
// company that requires two-step sign-in can send people here first.

export const metadata: Metadata = { title: "Sign-in security" };

function readCodes(value: string | undefined): string[] | null {
  if (!value) return null;
  try {
    return JSON.parse(open(value, sessionSecret(), RECOVERY_PURPOSE)) as string[];
  } catch {
    return null;
  }
}

export default async function SecurityPage({ params, searchParams }: PageProps<"/e/[slug]/account/security">) {
  const { slug } = await params;
  const sp = await searchParams;
  const current = await lookupCompany(slug);
  if (current.kind === "signed_out" || current.kind === "invited") redirect("/sign-in");
  if (current.kind === "no_access") redirect("/sign-in?error=" + encodeURIComponent("You are not a member of this company."));

  const companyName = current.company.name;
  const required = current.twoStep.required && !current.twoStep.enabled;
  const status = twoStepAvailable() ? await twoStepStatus(current.userId, current.userEmail) : null;
  const codes = readCodes((await cookies()).get(RECOVERY_COOKIE)?.value);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      {!required ? (
        <Link href="/" className="text-sm font-semibold text-zinc-600 underline dark:text-zinc-400">
          ← Back to {companyName}
        </Link>
      ) : null}
      <h1 className="mt-4 mb-1 text-2xl font-bold">Sign-in security</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">{current.userEmail}</p>
      <Notice error={sp.error} success={sp.success} />
      {required ? (
        <p className="mb-4 rounded-[var(--radius,0.5rem)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {companyName} asks everyone who manages the company to use two-step sign-in. Set it up to carry on.
        </p>
      ) : null}

      {!status ? (
        <Card>
          <p className="text-sm">Two-step sign-in is managed by your sign-in provider (Supabase Auth). Set it up there.</p>
        </Card>
      ) : codes ? (
        <Card title="Your recovery codes">
          <p className="mb-3 text-sm">
            If you lose your phone, each of these codes lets you sign in once. Write them down or print them and keep them somewhere safe. They will not be shown
            again.
          </p>
          <ul className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Recovery codes">
            {codes.map((c) => (
              <li key={c} className="rounded border border-zinc-200 px-2 py-1 text-center dark:border-zinc-700">
                {c}
              </li>
            ))}
          </ul>
          <form action={savedRecoveryCodes}>
            <Button type="submit">I have saved them</Button>
          </form>
        </Card>
      ) : status.enabled ? (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold">Two-step sign-in</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  You enter a code from your authenticator app each time you sign in. {status.recoveryCodesLeft} recovery code
                  {status.recoveryCodesLeft === 1 ? "" : "s"} left.
                </p>
              </div>
              <Badge tone="ok">On</Badge>
            </div>
          </Card>
          <Card title="New recovery codes">
            <form action={newRecoveryCodes} className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <Field label="Code from your app" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
              </div>
              <Button type="submit" variant="secondary">
                Make new codes
              </Button>
            </form>
          </Card>
          {!current.twoStep.required ? (
            <Card title="Turn off two-step sign-in">
              <form action={turnOff} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field label="Code from your app, or a recovery code" name="code" required autoComplete="one-time-code" maxLength={12} />
                </div>
                <Button type="submit" variant="secondary">
                  Turn off
                </Button>
              </form>
            </Card>
          ) : (
            <p className="text-sm text-zinc-500">{companyName} requires two-step sign-in for your role, so it cannot be turned off.</p>
          )}
        </div>
      ) : status.pending ? (
        <Card title="Set up two-step sign-in">
          <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm">
            <li>
              Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and add an account.
            </li>
            <li>
              Scan this code with the app:
              <span
                className="my-2 block w-48 rounded bg-white p-2"
                role="img"
                aria-label="QR code for adding ZimERP to your authenticator app"
                // QR code SVG made on the server from the setup link (no outside content).
                dangerouslySetInnerHTML={{ __html: await QRCode.toString(status.pending.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) }}
              />
              On this phone instead?{" "}
              <a href={status.pending.uri} className="font-semibold text-[var(--brand,#0b6e4f)] underline">
                Add ZimERP to your authenticator app
              </a>
              . Otherwise choose to enter a setup key and type:
              <span className="mt-1 block break-words rounded bg-zinc-100 px-2 py-1 font-mono text-base tracking-wider dark:bg-zinc-800" data-testid="totp-secret">
                {groupSecret(status.pending.secret)}
              </span>
              <span className="text-xs text-zinc-500">Time-based, 6 digits.</span>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <form action={confirmSetup} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <Field label="Code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
            </div>
            <Button type="submit">Turn on</Button>
          </form>
          <form action={cancelSetup} className="mt-3">
            <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Cancel
            </button>
          </form>
        </Card>
      ) : (
        <Card title="Two-step sign-in">
          <p className="mb-4 text-sm">
            Protect your account with a second step: after your email, you enter a code from an authenticator app on your phone. Someone who learns your
            email address still cannot get in.
          </p>
          <form action={startSetup}>
            <Button type="submit">Set up two-step sign-in</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
