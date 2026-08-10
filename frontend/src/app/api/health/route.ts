import { NextResponse } from "next/server";

import { requestHealth } from "@/lib/api/health";
import { apiRouteErrorResponse } from "@/lib/api/route-error";

export async function GET() {
  try {
    const health = await requestHealth();
    return NextResponse.json(health);
  } catch (error) {
    return apiRouteErrorResponse(error, "Failed to reach the backend.");
  }
}
