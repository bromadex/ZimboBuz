import { cookies } from "next/headers";
import { readView, singleHost, VIEW_COOKIE } from "@/lib/tenancy/single-host";

// Test mode on one address (src/lib/tenancy/single-host.ts): a slim bar
// saying which company and area this browser is looking at, with the way to
// the other area and back to ZimERP. Not shown on real domains.
export async function TestModeBar() {
  // Read the cookie first: it makes the page render per request, so the
  // setting is read at run time rather than when the app was built.
  const view = readView((await cookies()).get(VIEW_COOKIE)?.value);
  if (!singleHost()) return null;
  const link = "font-semibold underline underline-offset-2";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <span>
        <strong>Test address.</strong>{" "}
        {view ? `You are viewing the ${view.area === "erp" ? "ERP" : "website"} of “${view.slug}”.` : "Companies get their own addresses once ZimERP's domain is live."}
      </span>
      {view ? (
        <>
          <a className={link} href={view.area === "erp" ? `/site/${view.slug}` : `/erp/${view.slug}`}>
            {view.area === "erp" ? "Open the website" : "Open the ERP"}
          </a>
          <a className={link} href="/leave">
            Back to ZimERP
          </a>
        </>
      ) : null}
    </div>
  );
}
