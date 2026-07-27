import { getAccessToken } from "@/lib/auth/cookies";

import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
import type { Task } from "../types";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

async function djangoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(`${API_BASE_URL}/api/tasks${path}`, { ...init, headers, cache: "no-store" });
}

function isDuplicateIdError(body: unknown): boolean {
  const idErrors = (body as { id?: unknown } | null)?.id;
  return (
    Array.isArray(idErrors) &&
    idErrors.some((message) => typeof message === "string" && message.includes("already exists"))
  );
}

export async function requestListTasks(): Promise<Task[]> {
  const response = await djangoFetch("/");
  if (!response.ok) throw new Error("Failed to load tasks.");
  const payloads: ApiTask[] = await response.json();
  return payloads.map(fromApiPayload);
}

export async function requestCreateTask(
  task: Task,
): Promise<{ status: number; task?: Task; duplicateId: boolean }> {
  const response = await djangoFetch("/", {
    method: "POST",
    body: JSON.stringify(toApiPayload(task)),
  });
  if (response.ok) {
    return { status: response.status, task: fromApiPayload(await response.json()), duplicateId: false };
  }
  const body: unknown = response.status === 400 ? await response.json().catch(() => null) : null;
  return { status: response.status, duplicateId: response.status === 400 && isDuplicateIdError(body) };
}

export async function requestUpdateTask(task: Task): Promise<Task> {
  const response = await djangoFetch(`/${task.id}/`, {
    method: "PUT",
    body: JSON.stringify(toApiPayload(task)),
  });
  if (!response.ok) throw new Error("Failed to save task.");
  return fromApiPayload(await response.json());
}

export async function requestDeleteTask(id: string): Promise<void> {
  const response = await djangoFetch(`/${id}/`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete task.");
}
