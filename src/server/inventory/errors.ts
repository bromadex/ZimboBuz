import { formatQuantity } from "@/lib/format";

// Plain-English messages for the inventory rules enforced by the database
// (supabase/migrations/*_inventory*.sql). Returns null for anything else.

export function inventoryMessage(error: unknown): string | null {
  const e = error as { code?: string; message?: string };
  const m = e?.message ?? "";
  const short = /^not enough stock: this would leave (-?[\d.]+) at the location$/.exec(m);
  if (short) {
    return `There is not enough stock at that location: this would leave it ${formatQuantity(-Number(short[1]))} short. Check the quantity, or receive the stock first.`;
  }
  if (m === "this product is not a stock item") {
    return "That product is a service, so it has no stock. To count it, tick “Keep stock of this item” on the product first.";
  }
  if (m === "lines can only be changed while the document is a draft") return "This has been submitted, so its lines can no longer change.";
  if (m === "submitted documents are locked; cancel and amend instead" || m.startsWith("submitted documents are locked")) {
    return "This has already been submitted, so it can no longer change.";
  }
  if (m === "cancelled documents cannot be changed") return "This has been cancelled, so it can no longer change.";
  if (m === "a reason is required to cancel") return "Please give a reason for cancelling.";
  if (e?.code === "23514" || e?.code === "P0001") {
    if (m.startsWith("the main location") || m.startsWith("this location still holds") || m.startsWith("an archived location") ||
        m.startsWith("the price in your base currency") || m.startsWith("add at least one") || m.startsWith("this stock take has") ||
        m.startsWith("a location cannot")) {
      return m.charAt(0).toUpperCase() + m.slice(1) + ".";
    }
  }
  if (e?.code === "23505" && /stock_locations/.test((error as { constraint?: string }).constraint ?? "")) {
    return "That branch already has a location with that code.";
  }
  if (e?.code === "23505" && /barcode/.test((error as { constraint?: string }).constraint ?? "")) {
    return "Another product already has that barcode.";
  }
  return null;
}
