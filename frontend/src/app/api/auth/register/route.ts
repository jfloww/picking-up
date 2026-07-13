import { NextResponse, type NextRequest } from "next/server";

import { requestRegister } from "@/features/auth/api/auth";

export async function POST(request: NextRequest) {
  try {
    const credentials = await request.json();
    const user = await requestRegister(credentials);

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Registration failed." },
      { status: 400 },
    );
  }
}
