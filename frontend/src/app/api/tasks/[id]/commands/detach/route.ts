import { NextResponse, type NextRequest } from "next/server";

import { TaskApiError, requestDetachTask, type DetachTaskRequest } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseDetachCommand(body: unknown): DetachTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.occurrenceVersion !== "number") return null;
  if (
    candidate.repeatWeekdays !== undefined &&
    !(Array.isArray(candidate.repeatWeekdays) && candidate.repeatWeekdays.every((d) => typeof d === "number"))
  ) {
    return null;
  }
  return {
    occurrenceVersion: candidate.occurrenceVersion,
    repeatWeekdays: candidate.repeatWeekdays as number[] | undefined,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseDetachCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "occurrenceVersion (number) is required; repeatWeekdays, if present, must be number[]." },
        { status: 400 },
      );
    }
    const result = await requestDetachTask(id, command);
    return NextResponse.json(
      { occurrence: result.occurrence, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detach task." },
      { status: 400 },
    );
  }
}
