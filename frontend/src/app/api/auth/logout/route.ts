import { NextResponse } from "next/server";

import { clearAuthCookies, getRefreshToken } from "@/lib/auth/cookies";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

export async function POST() {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    await fetch(`${API_BASE_URL}/api/auth/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });

  clearAuthCookies(response);
  return response;
}
