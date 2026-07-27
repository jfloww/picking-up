import { NextResponse, type NextRequest } from "next/server";

import { requestCreateTask, requestListTasks } from "@/features/tasks/api/tasks";

export async function GET() {
  try {
    const tasks = await requestListTasks();
    return NextResponse.json(tasks);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tasks." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const task = await request.json();
  const result = await requestCreateTask(task);
  if (result.task) {
    return NextResponse.json(result.task, { status: 201 });
  }
  return NextResponse.json(
    { error: "Failed to save task." },
    { status: result.duplicateId ? 409 : 400 },
  );
}
