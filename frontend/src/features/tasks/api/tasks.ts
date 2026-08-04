import { apiRequest } from "@/lib/api/server";
import { getAccessToken } from "@/lib/auth/server-cookies";

import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
import type { Task } from "../types";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

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

export async function requestUpdateTask(task: Task): Promise<Task> {
  const payload = await apiRequest<ApiTask>(`/api/tasks/${task.id}/`, {
    method: "PUT",
    body: JSON.stringify(toApiPayload(task)),
    authenticated: true,
  });
  return fromApiPayload(payload);
}

export async function requestDeleteTask(id: string): Promise<void> {
  await apiRequest(`/api/tasks/${id}/`, { method: "DELETE", authenticated: true });
}
