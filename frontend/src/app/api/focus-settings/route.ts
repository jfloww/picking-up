import { NextResponse, type NextRequest } from "next/server";

import {
  requestGetFocusSettings,
  requestSaveFocusSettings,
} from "@/features/focus/api/focus-settings";
import type { FocusSettings } from "@/features/focus/types";
import { ApiResponseError, ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function GET() {
  try {
    return NextResponse.json(await requestGetFocusSettings());
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load focus areas." },
      { status: error instanceof ApiResponseError ? error.status : 502 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const settings = (await request.json()) as FocusSettings;
    return NextResponse.json(await requestSaveFocusSettings(settings));
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save focus areas." },
      { status: error instanceof ApiResponseError ? error.status : 400 },
    );
  }
}
