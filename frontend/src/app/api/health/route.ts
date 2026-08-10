import { NextResponse } from "next/server";

import { requestHealth } from "@/lib/api/health";
import { apiRouteErrorResponse } from "@/lib/api/route-error";
import { ApiResponseError } from "@/lib/api/server";

export async function GET() {
  try {
    const health = await requestHealth();
    return NextResponse.json(health);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      return apiRouteErrorResponse(error, "Failed to reach the backend.");
    }
    return NextResponse.json({ error: "Failed to reach the backend." }, { status: 502 });
  }
}
