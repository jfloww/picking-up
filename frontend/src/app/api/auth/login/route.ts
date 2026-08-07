import { NextResponse, type NextRequest } from "next/server";

import { setAuthCookies } from "@/lib/auth/cookies";
import { requestLogin } from "@/features/auth/api/auth";
import { apiRouteErrorResponse } from "@/lib/api/route-error";

export async function POST(request: NextRequest) {
  try {
    const credentials = await request.json();
    const tokens = await requestLogin(credentials);
    const response = NextResponse.json({ ok: true });

    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    return apiRouteErrorResponse(error, "Login failed.");
  }
}
