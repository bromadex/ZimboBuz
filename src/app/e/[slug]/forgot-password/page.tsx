import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui";
import { authMode } from "@/server/auth";
import { forgotPassword } from "../sign-in/actions";

export const metadata: Metadata = { title: "Forgot your password?" };

export default async function ForgotPasswordPage({ params, searchParams }: PageProps<"/e/[slug]/forgot-password">) {
  const { slug } = await params;
  const sp = await searchParams;
  if (authMode() === "dev") redirect("/sign-in");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold">Forgot your password?</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        We will email you a link to choose a new one for {slug} on ZimERP.
      </p>
      <Notice error={typeof sp.error === "string" ? sp.error : undefined} />
      <Card>
        <form action={forgotPassword.bind(null, slug)} className="space-y-4">
          <Field label="Email address" name="email" type="email" required autoComplete="email" />
          <Button type="submit" className="w-full">
            Send the link
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/sign-in" className="text-zinc-600 underline dark:text-zinc-400">
            Back to sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
