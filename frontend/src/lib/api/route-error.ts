import { NextResponse } from "next/server";

import { ApiResponseError } from "./server";

export function apiRouteErrorResponse(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = error instanceof ApiResponseError ? error.status : 400;
  const response = NextResponse.json({ error: message }, { status });

  if (error instanceof ApiResponseError && error.retryAfter) {
    response.headers.set("Retry-After", error.retryAfter);
  }
  return response;
}
