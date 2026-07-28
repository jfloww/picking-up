import { NextResponse, type NextRequest } from "next/server";

import { requestCreateTask, requestListTasks } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function GET() {
  try {
    const tasks = await requestListTasks();
    return NextResponse.json(tasks);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tasks." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const task = await request.json();
  const result = await requestCreateTask(task);
  // requestCreateTask does its own fetch rather than going through
  // apiRequest (see its own comment), so it can't throw ApiUnauthorizedError
  // — it already carries the raw status through instead.
  if (result.status === 401) return unauthorizedResponse();
  if (result.task) {
    return NextResponse.json(result.task, { status: 201 });
  }
  return NextResponse.json(
    { error: "Failed to save task." },
    { status: result.duplicateId ? 409 : 400 },
  );
}
