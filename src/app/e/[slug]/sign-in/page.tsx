import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui";
import { authMode } from "@/server/auth";
import { lookupCompany } from "@/server/company";
import { safeNextPath } from "@/server/urls";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ params, searchParams }: PageProps<"/e/[slug]/sign-in">) {
  const { slug } = await params;
  const sp = await searchParams;
  const current = await lookupCompany(slug);
  if (current.kind === "ok") redirect("/");
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : "/");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold">Sign in</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">to {slug} on ZimERP</p>
      <Notice error={current.kind === "no_access" ? `${current.userEmail} is not a member of this company.` : sp.error} />
      <Card>
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email address" name="email" type="email" required autoComplete="email" />
          {authMode() === "dev" ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">Development sign-in: no password is needed.</p>
          ) : null}
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
