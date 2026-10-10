import { Suspense } from "react";

// Company ERP (placeholder until the ERP screens). Reached only through the
// proxy, which maps erp.<company> addresses here.

async function Erp({ params }: { params: PageProps<"/e/[slug]/[[...path]]">["params"] }) {
  const { slug } = await params;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">{slug} · ERP</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Sign-in and the ERP screens arrive with Release 1 features.</p>
    </main>
  );
}

export default function Page(props: PageProps<"/e/[slug]/[[...path]]">) {
  return (
    <Suspense>
      <Erp params={props.params} />
    </Suspense>
  );
}
