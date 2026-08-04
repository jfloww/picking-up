import { NextResponse, type NextRequest } from "next/server";

import { requestRenameCategory } from "@/features/tasks/api/categories";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name } = await request.json();
    const category = await requestRenameCategory(id, name);
    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename category." },
      { status: 400 },
    );
  }
}
