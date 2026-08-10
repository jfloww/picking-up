import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies the backend's health response", async () => {
    const backendHealth = {
      status: "ok",
      service: "picking-up-api",
      version: "0.1.0",
      commit: "a84c20f",
      environment: "production",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(backendHealth)));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(backendHealth);
  });

  it("returns the backend's error status and message when Django responds with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Backend down." }, 502)),
    );

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Backend down." });
  });

  it("returns a 502 when the backend cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to reach the backend." });
  });
});
