import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/auth/google", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets auth cookies and returns ok on a successful Google sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access: "access-token", refresh: "refresh-token" })),
    );

    const request = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "google-id-token" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.cookies.get("access_token")?.value).toBe("access-token");
    expect(response.cookies.get("refresh_token")?.value).toBe("refresh-token");
  });

  it("returns the error message and sets no cookies when Django rejects the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)),
    );

    const request = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "bad-token" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Google credential." });
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("preserves Django's throttle status and Retry-After header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Request was throttled." }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        }),
      ),
    );

    const request = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "google-id-token" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({ error: "Request was throttled." });
  });
});
