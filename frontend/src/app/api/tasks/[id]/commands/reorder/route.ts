import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestReorderTask,
  type ReorderTaskRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseReorderCommand(body: unknown): ReorderTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.taskVersion !== "number") return null;
  if (candidate.insertBeforeId !== null && typeof candidate.insertBeforeId !== "string") return null;
  return {
    taskVersion: candidate.taskVersion,
    insertBeforeId: candidate.insertBeforeId as string | null,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseReorderCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "taskVersion (number) is required; insertBeforeId must be a string or null." },
        { status: 400 },
      );
    }
    const result = await requestReorderTask(id, command);
    return NextResponse.json({ task: result.task }, { status: result.status });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder task." },
      { status: 400 },
    );
  }
}
