import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestRescheduleTask,
  type RescheduleTaskRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseRescheduleCommand(body: unknown): RescheduleTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.taskVersion !== "number" || typeof candidate.date !== "string") return null;
  return { taskVersion: candidate.taskVersion, date: candidate.date };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseRescheduleCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "taskVersion (number) and date (string) are required." },
        { status: 400 },
      );
    }
    const result = await requestRescheduleTask(id, command);
    return NextResponse.json(
      { task: result.task, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reschedule task." },
      { status: 400 },
    );
  }
}
