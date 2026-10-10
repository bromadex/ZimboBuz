import { Suspense } from "react";

// Company website and store (placeholder until the website builder, P9).
// Reached only through the proxy, which maps the company's domain here.

async function Site({ params }: { params: PageProps<"/s/[slug]/[[...path]]">["params"] }) {
  const { slug, path } = await params;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">{slug}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        This company&apos;s website is being set up{path?.length ? ` (/${path.join("/")})` : ""}.
      </p>
    </main>
  );
}

export default function Page(props: PageProps<"/s/[slug]/[[...path]]">) {
  return (
    <Suspense>
      <Site params={props.params} />
    </Suspense>
  );
}
