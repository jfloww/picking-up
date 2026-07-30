import { describe, expect, it } from "vitest";

import { scopeKey } from "./types";

describe("scopeKey", () => {
  it("returns a distinct key per scope kind", () => {
    expect(scopeKey({ kind: "day", date: "2026-07-16" })).toBe("day:2026-07-16");
    expect(scopeKey({ kind: "week", weekStart: "2026-07-12" })).toBe("week:2026-07-12");
    expect(scopeKey({ kind: "month", month: "2026-07" })).toBe("month:2026-07");
    expect(scopeKey({ kind: "year", year: "2026" })).toBe("year:2026");
  });

  it("returns a category-based key for a bucket scope", () => {
    expect(scopeKey({ kind: "bucket", category: "To Eat" })).toBe("bucket:To Eat");
  });
});
