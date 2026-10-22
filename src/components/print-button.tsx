"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
