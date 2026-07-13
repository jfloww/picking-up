import { NextResponse } from "next/server";

import { requestCurrentUser } from "@/features/auth/api/auth";

export async function GET() {
  try {
    const user = await requestCurrentUser();

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
