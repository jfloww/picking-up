import { NextResponse, type NextRequest } from "next/server";

import { TaskApiError, requestNestTask, type NestTaskRequest } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

// RF-005 review finding: this route used to hand the parsed body straight
// to requestNestTask() with no shape check, unlike the sibling PUT route's
// careful If-Match parsing. A missing confirmDataLoss silently became
// `undefined` and was dropped entirely by JSON.stringify before reaching
// Django, rather than failing fast here with a clear error.
function parseNestCommand(body: unknown): NestTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.targetId !== "string" ||
    typeof candidate.sourceVersion !== "number" ||
    typeof candidate.targetVersion !== "number" ||
    typeof candidate.subtaskId !== "string" ||
    typeof candidate.confirmDataLoss !== "boolean"
  ) {
    return null;
  }
  return {
    targetId: candidate.targetId,
    sourceVersion: candidate.sourceVersion,
    targetVersion: candidate.targetVersion,
    subtaskId: candidate.subtaskId,
    confirmDataLoss: candidate.confirmDataLoss,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseNestCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        {
          error:
            "targetId (string), sourceVersion (number), targetVersion (number), " +
            "subtaskId (string), and confirmDataLoss (boolean) are required.",
        },
        { status: 400 },
      );
    }
    const result = await requestNestTask(id, command);
    return NextResponse.json(
      { target: result.target, removedTaskId: result.removedTaskId },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to nest task." },
      { status: 400 },
    );
  }
}
