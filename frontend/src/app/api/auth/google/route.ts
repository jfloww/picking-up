import { NextResponse, type NextRequest } from "next/server";

import { setAuthCookies } from "@/lib/auth/cookies";
import { requestGoogleLogin } from "@/features/auth/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { credential } = await request.json();
    const tokens = await requestGoogleLogin(credential);
    const response = NextResponse.json({ ok: true });

    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google sign-in failed." },
      { status: 400 },
    );
  }
}
