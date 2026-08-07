import { ApiUnauthorizedError, apiRequest } from "@/lib/api/server";
import { getAccessToken } from "@/lib/auth/server-cookies";

import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
import type { Task } from "../types";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

export class TaskApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    const payload = body as { detail?: unknown; error?: unknown } | null;
    const message =
      (typeof payload?.detail === "string" && payload.detail) ||
      (typeof payload?.error === "string" && payload.error) ||
      "Task request failed.";
    super(message);
    this.name = "TaskApiError";
  }
}

async function taskMutationRequest(path: string, init: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (response.status === 401) throw new ApiUnauthorizedError();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TaskApiError(response.status, body);
  }
  return response;
}

function isDuplicateIdError(body: unknown): boolean {
  const idErrors = (body as { id?: unknown } | null)?.id;
  return (
    Array.isArray(idErrors) &&
    idErrors.some((message) => typeof message === "string" && message.includes("already exists"))
  );
}

export async function requestListTasks(): Promise<Task[]> {
  const payloads = await apiRequest<ApiTask[]>("/api/tasks/", { authenticated: true });
  return payloads.map(fromApiPayload);
}

export async function requestCreateTask(
  task: Task,
): Promise<{ status: number; task?: Task; duplicateId: boolean }> {
  // apiRequest throws on a non-ok response and only preserves a flattened
  // message string — this call needs the raw status and body to
  // distinguish a tolerable duplicate-id 400 from a real validation
  // failure, so it does its own fetch instead of going through apiRequest.
  const accessToken = await getAccessToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE_URL}/api/tasks/`, {
    method: "POST",
    headers,
    body: JSON.stringify(toApiPayload(task)),
    cache: "no-store",
  });
  if (response.ok) {
    return { status: response.status, task: fromApiPayload(await response.json()), duplicateId: false };
  }
  const body: unknown = response.status === 400 ? await response.json().catch(() => null) : null;
  return { status: response.status, duplicateId: response.status === 400 && isDuplicateIdError(body) };
}

export async function requestUpdateTask(taskId: string, task: Task): Promise<Task> {
  const response = await taskMutationRequest(`/api/tasks/${taskId}/`, {
    method: "PUT",
    headers: { "If-Match": `"${task.version}"` },
    body: JSON.stringify(toApiPayload(task)),
  });
  return fromApiPayload((await response.json()) as ApiTask);
}

export async function requestDeleteTask(id: string, version: number): Promise<void> {
  await taskMutationRequest(`/api/tasks/${id}/`, {
    method: "DELETE",
    headers: { "If-Match": `"${version}"` },
  });
}

export interface NestTaskRequest {
  targetId: string;
  sourceVersion: number;
  targetVersion: number;
  subtaskId: string;
  confirmDataLoss: boolean;
}

export interface NestTaskResponse {
  target: Task;
  removedTaskId: string;
  // The BFF route echoes this back instead of hardcoding a status, so it
  // stays correct if Django's success status for this command ever changes
  // (RF-005 review finding — the "preserve Django's status" claim in the
  // design doc previously only held on the error path).
  status: number;
}

export async function requestNestTask(
  sourceId: string,
  command: NestTaskRequest,
): Promise<NestTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${sourceId}/commands/nest/`, {
    method: "POST",
    body: JSON.stringify({
      target_id: command.targetId,
      source_version: command.sourceVersion,
      target_version: command.targetVersion,
      subtask_id: command.subtaskId,
      confirm_data_loss: command.confirmDataLoss,
    }),
  });
  const payload = (await response.json()) as {
    target: ApiTask;
    removed_task_id: string;
  };
  return {
    target: fromApiPayload(payload.target),
    removedTaskId: payload.removed_task_id,
    status: response.status,
  };
}

export interface PromoteSubtaskRequest {
  subtaskId: string;
  parentVersion: number;
  newTaskId: string;
}

export interface PromoteSubtaskResponse {
  parent: Task;
  task: Task;
  status: number;
}

export async function requestPromoteSubtask(
  parentId: string,
  command: PromoteSubtaskRequest,
): Promise<PromoteSubtaskResponse> {
  const response = await taskMutationRequest(
    `/api/tasks/${parentId}/commands/promote-subtask/`,
    {
      method: "POST",
      body: JSON.stringify({
        subtask_id: command.subtaskId,
        parent_version: command.parentVersion,
        new_task_id: command.newTaskId,
      }),
    },
  );
  const payload = (await response.json()) as { parent: ApiTask; task: ApiTask };
  return {
    parent: fromApiPayload(payload.parent),
    task: fromApiPayload(payload.task),
    status: response.status,
  };
}

export interface DetachTaskRequest {
  occurrenceVersion: number;
  repeatWeekdays?: number[];
}

export interface DetachTaskResponse {
  occurrence: Task;
  anchor?: Task;
  status: number;
}

export async function requestDetachTask(
  occurrenceId: string,
  command: DetachTaskRequest,
): Promise<DetachTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${occurrenceId}/commands/detach/`, {
    method: "POST",
    body: JSON.stringify({
      occurrence_version: command.occurrenceVersion,
      repeat_weekdays: command.repeatWeekdays ?? null,
    }),
  });
  const payload = (await response.json()) as { occurrence: ApiTask; anchor?: ApiTask };
  return {
    occurrence: fromApiPayload(payload.occurrence),
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}

export interface DeleteOccurrenceRequest {
  occurrenceVersion: number;
}

export interface DeleteOccurrenceResponse {
  removedTaskId: string;
  anchor?: Task;
  status: number;
}

export async function requestDeleteOccurrence(
  occurrenceId: string,
  command: DeleteOccurrenceRequest,
): Promise<DeleteOccurrenceResponse> {
  const response = await taskMutationRequest(
    `/api/tasks/${occurrenceId}/commands/delete-occurrence/`,
    {
      method: "POST",
      body: JSON.stringify({ occurrence_version: command.occurrenceVersion }),
    },
  );
  const payload = (await response.json()) as { removed_task_id: string; anchor?: ApiTask };
  return {
    removedTaskId: payload.removed_task_id,
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}

export interface RescheduleTaskRequest {
  taskVersion: number;
  date: string;
}

export interface RescheduleTaskResponse {
  task: Task;
  anchor?: Task;
  status: number;
}

export async function requestRescheduleTask(
  taskId: string,
  command: RescheduleTaskRequest,
): Promise<RescheduleTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${taskId}/commands/reschedule/`, {
    method: "POST",
    body: JSON.stringify({ task_version: command.taskVersion, date: command.date }),
  });
  const payload = (await response.json()) as { task: ApiTask; anchor?: ApiTask };
  return {
    task: fromApiPayload(payload.task),
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}
