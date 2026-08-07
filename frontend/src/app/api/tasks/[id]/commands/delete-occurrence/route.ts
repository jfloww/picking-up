import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestDeleteOccurrence,
  type DeleteOccurrenceRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseDeleteOccurrenceCommand(body: unknown): DeleteOccurrenceRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.occurrenceVersion !== "number") return null;
  return { occurrenceVersion: candidate.occurrenceVersion };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseDeleteOccurrenceCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "occurrenceVersion (number) is required." },
        { status: 400 },
      );
    }
    const result = await requestDeleteOccurrence(id, command);
    return NextResponse.json(
      { removedTaskId: result.removedTaskId, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete occurrence." },
      { status: 400 },
    );
  }
}
