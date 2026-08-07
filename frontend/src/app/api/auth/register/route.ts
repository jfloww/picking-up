import { NextResponse, type NextRequest } from "next/server";

import { requestRegister } from "@/features/auth/api/auth";
import { apiRouteErrorResponse } from "@/lib/api/route-error";

export async function POST(request: NextRequest) {
  try {
    const credentials = await request.json();
    const user = await requestRegister(credentials);

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return apiRouteErrorResponse(error, "Registration failed.");
  }
}
