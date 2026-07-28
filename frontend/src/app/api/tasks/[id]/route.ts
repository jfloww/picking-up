import { NextResponse, type NextRequest } from "next/server";

import { requestDeleteTask, requestUpdateTask } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function PUT(request: NextRequest) {
  try {
    const task = await request.json();
    const updated = await requestUpdateTask(task);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save task." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requestDeleteTask(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete task." },
      { status: 400 },
    );
  }
}
