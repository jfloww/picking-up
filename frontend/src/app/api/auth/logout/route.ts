import { NextResponse } from "next/server";

import { requestLogout } from "@/features/auth/api/auth";
import { clearAuthCookies, getRefreshToken } from "@/lib/auth/cookies";

export async function POST() {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    // Best-effort: the user is logged out client-side regardless of whether
    // the backend call to blacklist the refresh token succeeds.
    await requestLogout(refreshToken).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });

  clearAuthCookies(response);
  return response;
}
