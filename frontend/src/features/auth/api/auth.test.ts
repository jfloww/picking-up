import { describe, expect, it, vi } from "vitest";

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
});
