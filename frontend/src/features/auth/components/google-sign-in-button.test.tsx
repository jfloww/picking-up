import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mirrors next/script's real dedup behavior (see next/dist/client/script.js):
// onLoad fires only the first time the script is ever loaded in the tab's
// session (a module-level LoadCache persists across mounts), while onReady
// fires every time the component mounts and the script is already loaded —
// including remounts after the script was cached by a prior mount. A naive
// mock that always calls both wouldn't be able to catch a regression back to
// onLoad, which is exactly the bug this file guards against.
const scriptState = vi.hoisted(() => ({ everLoaded: false }));

vi.mock("next/script", () => ({
  default: ({ onLoad, onReady }: { onLoad?: () => void; onReady?: () => void }) => {
    if (!scriptState.everLoaded) {
      scriptState.everLoaded = true;
      onLoad?.();
    }
    onReady?.();
    return null;
  },
}));

import { GoogleSignInButton, submitGoogleCredential } from "./google-sign-in-button";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("submitGoogleCredential", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok on a successful sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    expect(await submitGoogleCredential("id-token")).toEqual({ ok: true });
  });

  it("returns the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)));

    expect(await submitGoogleCredential("id-token")).toEqual({
      ok: false,
      error: "Invalid Google credential.",
    });
  });
});

describe("GoogleSignInButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { google?: unknown }).google;
    replaceMock.mockClear();
    refreshMock.mockClear();
    scriptState.everLoaded = false;
  });

  it("initializes GIS with the configured client id and renders the button", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };

    render(<GoogleSignInButton />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize.mock.calls[0][0]).toMatchObject({ client_id: "test-client-id" });
    expect(renderButton).toHaveBeenCalledTimes(1);
  });

  it("redirects on a successful credential callback", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    await callback({ credential: "id-token" });

    expect(replaceMock).toHaveBeenCalledWith("/planner");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an error and does not redirect when the callback fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)));
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    await callback({ credential: "bad-token" });

    await screen.findByText("Invalid Google credential.");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("re-initializes GIS when remounted after the script was already loaded once (e.g. navigating back to /login after logout)", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };

    const { unmount } = render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    unmount();

    // Simulate a client-side navigation back to /login (logout, then GIS
    // stays loaded from before): the script mock's LoadCache simulation
    // means only onReady fires this time, not onLoad.
    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    expect(renderButton).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");

    const { container } = render(<GoogleSignInButton />);

    expect(container.firstChild).toBeNull();
  });
});
