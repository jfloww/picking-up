import { NextResponse, type NextRequest } from "next/server";

import { requestCreateCategory, requestListCategories } from "@/features/tasks/api/categories";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function GET() {
  try {
    const categories = await requestListCategories();
    return NextResponse.json(categories);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load categories." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    const category = await requestCreateCategory(name);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create category." },
      { status: 400 },
    );
  }
}
