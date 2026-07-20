import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue(undefined),
}));

import type { CurrentUser } from "../types";
import { getCurrentUserOrNull } from "./auth";

const user: CurrentUser = { id: 1, email: "jane@example.com" };

describe("getCurrentUserOrNull", () => {
  it("returns the user when the fetch succeeds", async () => {
    const fetchUser = vi.fn().mockResolvedValue(user);
    expect(await getCurrentUserOrNull(fetchUser)).toEqual(user);
  });

  it("returns null when the fetch throws", async () => {
    const fetchUser = vi.fn().mockRejectedValue(new Error("Unauthorized."));
    expect(await getCurrentUserOrNull(fetchUser)).toBeNull();
  });

  it("short-circuits to null without fetching when there is no access token", async () => {
    // No fetchUser mock is provided, and requestCurrentUser/apiRequest are
    // never mocked. We stub global fetch only to prove it is never called —
    // if the short-circuit didn't exist, requestCurrentUser would reach
    // apiRequest, which would call this fetch stub.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await getCurrentUserOrNull()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
