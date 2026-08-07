import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

// exp in the past, so isAccessTokenValid() in middleware.ts treats it as expired.
function expiredAccessToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString(
    "base64url",
  );
  return `${header}.${payload}.sig`;
}

function requestWithCookies(url: string, cookieHeader: string): NextRequest {
  return new NextRequest(url, { headers: { cookie: cookieHeader } });
}

describe("middleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("silently refreshes an expired access token on a /api/tasks request instead of leaving it stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access: "new-access-token", refresh: "new-refresh-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const request = requestWithCookies(
      "http://localhost/api/tasks/41fdcb65-ca75-46f5-9790-04f246888cb6",
      `access_token=${expiredAccessToken()}; refresh_token=a-valid-refresh-token`,
    );

    const response = await middleware(request);

    // The refresh endpoint must actually have been called...
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/token/refresh/"),
      expect.objectContaining({ method: "POST" }),
    );
    // ...and the response must carry the refreshed access token forward, so
    // the route handler downstream sees a live token instead of the stale one.
    expect(response.cookies.get("access_token")?.value).toBe("new-access-token");
    // Never a redirect — /api/tasks isn't a page route.
    expect(response.headers.get("location")).toBeNull();
  });

  it("also refreshes an expired access token on a /api/categories request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access: "new-access-token", refresh: "new-refresh-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const request = requestWithCookies(
      "http://localhost/api/categories/41fdcb65-ca75-46f5-9790-04f246888cb6",
      `access_token=${expiredAccessToken()}; refresh_token=a-valid-refresh-token`,
    );

    const response = await middleware(request);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/token/refresh/"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.cookies.get("access_token")?.value).toBe("new-access-token");
    expect(response.headers.get("location")).toBeNull();
  });

  it("still lets a /api/tasks request through (unredirected) when the refresh token is also invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "Token is invalid or expired." }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const request = requestWithCookies(
      "http://localhost/api/tasks",
      `access_token=${expiredAccessToken()}; refresh_token=an-expired-refresh-token`,
    );

    const response = await middleware(request);

    expect(fetchMock).toHaveBeenCalled();
    // No redirect: the downstream route handler's own 401 handling (which
    // clears cookies and returns a clean 401 for the client to react to)
    // is what should run here, not a page-navigation redirect on an XHR call.
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("access_token")?.value).toBeUndefined();
  });
});
