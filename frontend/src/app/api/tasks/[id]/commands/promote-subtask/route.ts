import { NextResponse, type NextRequest } from "next/server";

import { TaskApiError, requestPromoteSubtask, type PromoteSubtaskRequest } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

// RF-005 review finding: see the sibling nest route for why this validates
// the body shape before forwarding it to Django.
function parsePromoteCommand(body: unknown): PromoteSubtaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.subtaskId !== "string" ||
    typeof candidate.parentVersion !== "number" ||
    typeof candidate.newTaskId !== "string"
  ) {
    return null;
  }
  return {
    subtaskId: candidate.subtaskId,
    parentVersion: candidate.parentVersion,
    newTaskId: candidate.newTaskId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parsePromoteCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "subtaskId (string), parentVersion (number), and newTaskId (string) are required." },
        { status: 400 },
      );
    }
    const result = await requestPromoteSubtask(id, command);
    return NextResponse.json(
      { parent: result.parent, task: result.task },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to promote subtask." },
      { status: 400 },
    );
  }
}
