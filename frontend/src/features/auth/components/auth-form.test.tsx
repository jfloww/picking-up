import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AuthForm } from "./auth-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AuthForm loading state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a spinner and 'Signing in…' while a login submission is in flight, then clears it", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText("Signing in…")).toBeTruthy();
    expect(screen.getByRole("button").disabled).toBe(true);

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.queryByText("Signing in…")).toBeNull());
  });

  it("shows 'Creating account…' while a signup submission is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "password123" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText("Creating account…")).toBeTruthy();

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.queryByText("Creating account…")).toBeNull());
  });
});
