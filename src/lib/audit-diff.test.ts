import { describe, expect, it } from "vitest";
import { auditChanges, fieldLabel } from "./audit-diff";

describe("auditChanges", () => {
  it("lists only what changed on an update, without noise", () => {
    expect(
      auditChanges(
        { id: "1", name: "Mhofu", vat_registered: false, updated_at: "a", plan_code: "business" },
        { id: "1", name: "Mhofu Hardware", vat_registered: true, updated_at: "b", plan_code: "business" },
      ),
    ).toEqual([
      { field: "Name", before: "Mhofu", after: "Mhofu Hardware" },
      { field: "Vat registered", before: "No", after: "Yes" },
    ]);
  });

  it("lists filled-in fields on an insert", () => {
    expect(auditChanges(null, { id: "1", name: "Till", notes: null, permissions: ["pos.sell", "pos.view"] })).toEqual([
      { field: "Name", before: "", after: "Till" },
      { field: "Permissions", before: "", after: "pos.sell, pos.view" },
    ]);
  });

  it("labels fields plainly", () => {
    expect(fieldLabel("credit_limit_cents")).toBe("Credit limit");
    expect(fieldLabel("role_id")).toBe("Role");
  });
});
