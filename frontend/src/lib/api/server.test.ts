import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server-cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue(undefined),
}));

import { ApiUnauthorizedError, apiRequest } from "./server";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("parses and returns the JSON body on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: 1 })));

    expect(await apiRequest("/api/things/")).toEqual({ id: 1 });
  });

  it("returns undefined for a 204 No Content response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    expect(await apiRequest("/api/things/1/")).toBeUndefined();
  });

  it("returns undefined for a 205 Reset Content response, e.g. Django's logout endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 205 })));

    expect(await apiRequest("/api/auth/logout/")).toBeUndefined();
  });

  it("throws with the backend's error detail on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Refresh token is required." }, 400)),
    );

    await expect(apiRequest("/api/auth/logout/")).rejects.toThrow(
      "Refresh token is required.",
    );
  });

  it("throws ApiUnauthorizedError, not a generic Error, on a 401 for an authenticated call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "expired" }, 401)));

    await expect(
      apiRequest("/api/tasks/", { authenticated: true }),
    ).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });

  it("throws a plain Error, not ApiUnauthorizedError, for a 401 on a non-authenticated call", async () => {
    // A login attempt with bad credentials is a normal user-facing error, not
    // a "your session expired" signal — it must not be conflated with the
    // authenticated-call case above.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Invalid credentials." }, 401)),
    );

    const error = await apiRequest("/api/auth/token/", { method: "POST" }).catch((e) => e);
    expect(error).not.toBeInstanceOf(ApiUnauthorizedError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Invalid credentials.");
  });
});
