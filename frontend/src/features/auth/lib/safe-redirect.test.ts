import { describe, expect, it } from "vitest";

import { DEFAULT_AUTH_REDIRECT, safeAuthRedirect } from "./safe-redirect";

describe("safeAuthRedirect", () => {
  it("falls back when next is missing or empty", () => {
    expect(safeAuthRedirect(null)).toBe(DEFAULT_AUTH_REDIRECT);
    expect(safeAuthRedirect("")).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("preserves a same-origin path, query, and fragment", () => {
    expect(safeAuthRedirect("/planner?view=weekly#today")).toBe(
      "/planner?view=weekly#today",
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
  ])("rejects an unsafe redirect target: %s", (candidate) => {
    expect(safeAuthRedirect(candidate)).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("supports an explicit safe fallback", () => {
    expect(safeAuthRedirect("https://evil.example", "/")).toBe("/");
  });
});
