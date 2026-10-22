import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui";
import { authMode, twoStepUserId } from "@/server/auth";
import { lookupCompany } from "@/server/company";
import { safeNextPath } from "@/server/urls";
import { signOut } from "../actions";
import { acceptInvitation, cancelSignIn, signIn, verifyCode } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ params, searchParams }: PageProps<"/e/[slug]/sign-in">) {
  const { slug } = await params;
  const sp = await searchParams;
  const current = await lookupCompany(slug);
  if (current.kind === "ok") redirect("/");
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : "/");
  const error = typeof sp.error === "string" ? sp.error : undefined;

  if (current.kind === "invited") {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
        <h1 className="mb-1 text-2xl font-bold">You have been invited</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Signed in as {current.userEmail}</p>
        <Notice error={error} />
        <Card>
          <p className="mb-4">
            You have been invited to <strong>{current.companyName}</strong> as <strong>{current.roleName}</strong>
            {current.userType === "light" ? " (light user)" : ""}.
          </p>
          <form action={acceptInvitation.bind(null, slug)}>
            <Button type="submit" className="w-full">
              Accept invitation
            </Button>
          </form>
          <form action={signOut} className="mt-3 text-center">
            <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Not you? Sign out
            </button>
          </form>
        </Card>
      </main>
    );
  }

  if (sp.step === "code" && (await twoStepUserId())) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
        <h1 className="mb-1 text-2xl font-bold">Two-step sign-in</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Enter the 6-digit code from your authenticator app.</p>
        <Notice error={error} />
        <Card>
          <form action={verifyCode} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field
              label="Code"
              name="code"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={12}
              hint="Lost your phone? Enter one of your recovery codes instead."
            />
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
          <form action={cancelSignIn} className="mt-3 text-center">
            <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Use a different email address
            </button>
          </form>
        </Card>
      </main>
    );
  }

  const refusal =
    current.kind === "no_access"
      ? current.disabled
        ? `${current.userEmail} no longer has access to this company. Ask the owner if you think this is a mistake.`
        : `${current.userEmail} is not a member of this company.`
      : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold">Sign in</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">to {slug} on ZimERP</p>
      <Notice error={refusal ?? error} success={typeof sp.success === "string" ? sp.success : undefined} />
      <Card>
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email address" name="email" type="email" required autoComplete="email" />
          {authMode() === "dev" ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">Development sign-in: no password is needed.</p>
          ) : (
            <Field label="Password" name="password" type="password" required autoComplete="current-password" />
          )}
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
        {authMode() === "dev" ? null : (
          <p className="mt-4 text-center text-sm">
            <Link href="/forgot-password" className="text-zinc-600 underline dark:text-zinc-400">
              Forgot your password?
            </Link>
          </p>
        )}
      </Card>
    </main>
  );
}
