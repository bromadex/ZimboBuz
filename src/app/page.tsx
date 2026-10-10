import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-600">Coming 2027</p>
      <h1 className="text-5xl font-extrabold tracking-tight">
        Zim<span className="text-emerald-700 dark:text-emerald-400">ERP</span>
      </h1>
      <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
        Run your whole business in one place: ZiG and USD, EcoCash, ZIMRA, website and email.
        Built for Zimbabwe.
      </p>
      <Link
        href="/signup"
        className="mt-4 rounded-lg bg-emerald-700 px-6 py-3 font-semibold text-white hover:bg-emerald-800"
      >
        Start your business
      </Link>
    </main>
  );
}
