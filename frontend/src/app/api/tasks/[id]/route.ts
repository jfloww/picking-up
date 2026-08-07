import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestDeleteTask,
  requestUpdateTask,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function taskApiErrorResponse(error: TaskApiError) {
  return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
}

function versionRequiredResponse() {
  return NextResponse.json(
    { code: "task_version_required", detail: "A quoted If-Match task version is required." },
    { status: 428 },
  );
}

function versionInvalidResponse() {
  return NextResponse.json(
    { code: "task_version_invalid", detail: "If-Match must contain one quoted positive integer." },
    { status: 400 },
  );
}

function parseIfMatchVersion(request: NextRequest): number | NextResponse {
  const rawVersion = request.headers.get("If-Match");
  if (rawVersion === null) return versionRequiredResponse();
  const match = rawVersion.trim().match(/^"([1-9][0-9]*)"$/);
  if (!match) return versionInvalidResponse();
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : versionInvalidResponse();
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedVersion = parseIfMatchVersion(request);
  if (typeof parsedVersion !== "number") return parsedVersion;
  const expectedVersion = parsedVersion;
  try {
    const task = await request.json();
    if (task?.version !== expectedVersion) {
      return NextResponse.json(
        {
          code: "task_version_mismatch",
          detail: "The If-Match header must match the task version in the request body.",
        },
        { status: 409 },
      );
    }
    const updated = await requestUpdateTask(id, { ...task, id, version: expectedVersion });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) return taskApiErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save task." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedVersion = parseIfMatchVersion(_request);
  if (typeof parsedVersion !== "number") return parsedVersion;
  const expectedVersion = parsedVersion;
  try {
    await requestDeleteTask(id, expectedVersion);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) return taskApiErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete task." },
      { status: 400 },
    );
  }
}
