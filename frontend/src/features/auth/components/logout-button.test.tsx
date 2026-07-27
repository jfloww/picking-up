import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { STORAGE_KEY } from "@/features/tasks/data/repository";

import { LogoutButton } from "./logout-button";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LogoutButton", () => {
  it("clears the legacy local task cache so the next account can't inherit it", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: "a" }]));
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });
});
