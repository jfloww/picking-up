import { NextResponse } from "next/server";

import { getCurrentUserOrNull } from "@/features/auth/api/auth";

export async function GET() {
  const user = await getCurrentUserOrNull();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ user });
}
