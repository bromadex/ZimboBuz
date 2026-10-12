import { describe, expect, it } from "vitest";
import { likePattern, listParams, withParams } from "./list-params";

const sorts = [
  { value: "name", label: "Name", sql: "name" },
  { value: "newest", label: "Newest", sql: "created_at desc" },
];

describe("list parameters", () => {
  it("reads search, page, sort and view safely", () => {
    const p = listParams({ q: "cement", page: "3", sort: "newest", view: "card" }, { sorts, pageSize: 10 });
    expect([p.q, p.page, p.offset, p.sort.sql, p.view]).toEqual(["cement", 3, 20, "created_at desc", "card"]);
    const bad = listParams({ page: "-4", sort: "1; drop table x", view: "grid" }, { sorts });
    expect([bad.page, bad.sort.sql, bad.view]).toEqual([1, "name", "list"]);
  });

  it("builds links that keep other settings", () => {
    expect(withParams({ q: "a", page: "2", success: "Saved" }, { page: 3 })).toBe("?q=a&page=3");
    expect(withParams({ q: "a" }, { q: undefined })).toBe("");
  });

  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});
