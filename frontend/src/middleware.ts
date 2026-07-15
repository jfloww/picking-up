import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from "@/lib/auth/cookies";

const protectedRoutes = ["/app"];
const authRoutes = ["/login", "/signup"];
const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

// Decode-only: the edge does not verify the signature, it just avoids
// treating an expired token as a live session. Django remains the
// authority that actually verifies every request.
function isAccessTokenValid(token: string | undefined): boolean {
  if (!token) return false;

  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" && decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

async function refreshTokens(refreshToken: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (!response.ok) return null;

    return (await response.json()) as { access: string; refresh?: string };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));
  const isAuthRoute = authRoutes.includes(pathname);

  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }

  let isAuthenticated = isAccessTokenValid(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
  let refreshedTokens: { access: string; refresh?: string } | null = null;

  if (!isAuthenticated) {
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

    if (refreshToken) {
      refreshedTokens = await refreshTokens(refreshToken);
      isAuthenticated = refreshedTokens !== null;
    }
  }

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);

    const response = NextResponse.redirect(loginUrl);
    clearAuthCookies(response);
    return response;
  }

  if (isAuthRoute && isAuthenticated) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/app";
    appUrl.search = "";

    const response = NextResponse.redirect(appUrl);
    if (refreshedTokens) setAuthCookies(response, refreshedTokens);
    return response;
  }

  if (refreshedTokens) {
    request.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access);
    const response = NextResponse.next({ request });
    setAuthCookies(response, refreshedTokens);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
