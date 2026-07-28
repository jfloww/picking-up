import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue(undefined),
}));

import { apiRequest } from "./server";

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
});
