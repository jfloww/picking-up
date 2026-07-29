import type { Task } from "../types";
import { createLocalStorageRepository, STORAGE_KEY, type TaskRepository } from "./repository";

async function parseJsonOrUndefined<T>(response: Response): Promise<T | undefined> {
  if (response.status === 204) return undefined;
  return response.json();
}

class SessionExpiredError extends Error {
  constructor() {
    super("Session expired.");
    this.name = "SessionExpiredError";
  }
}

// Our own /api/tasks routes return 401 (and clear the stale auth cookies)
// once the backend rejects the access token — see ApiUnauthorizedError in
// lib/api/server.ts. This is the one place all task fetches funnel through
// in the browser, so it's the natural spot to react to that centrally
// rather than surfacing it as a generic sync failure.
function guardUnauthorized(response: Response, redirectToLogin: () => void): void {
  if (response.status === 401) {
    redirectToLogin();
    throw new SessionExpiredError();
  }
}

async function uploadForMigration(task: Task, redirectToLogin: () => void): Promise<void> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  guardUnauthorized(response, redirectToLogin);
  if (response.ok || response.status === 409) return;
  throw new Error(`Failed to migrate task ${task.id}.`);
}

async function migrateLegacyLocalStorageTasks(redirectToLogin: () => void): Promise<void> {
  const legacyTasks = await createLocalStorageRepository().list();
  if (legacyTasks.length === 0) return;
  const stillLegacy: Task[] = [];
  for (const task of legacyTasks) {
    try {
      await uploadForMigration(task, redirectToLogin);
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      // Migration failed for this one task for a reason other than "already
      // exists" (a dangling repeatSourceId from a deleted anchor, an
      // over-length title, etc). Keep only this task in localStorage for a
      // later retry — every other task in the batch still gets cleared
      // below once it succeeds, so one stuck task can no longer block the
      // rest from clearing. (It previously could: a single bad task kept
      // the *entire* batch in localStorage forever, including tasks that
      // had already migrated successfully and were later deleted from the
      // server — every subsequent load would silently re-upload and
      // resurrect them, since a re-POST of an id that no longer exists
      // succeeds instead of hitting the expected 409.)
      stillLegacy.push(task);
      console.error(`Failed to migrate legacy task ${task.id}; will retry on next load.`, error);
    }
  }
  if (stillLegacy.length > 0) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stillLegacy));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function createApiTaskRepository(
  redirectToLogin: () => void = () => {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  },
): TaskRepository {
  return {
    async list() {
      // Only a SessionExpiredError can still escape here — a per-task
      // migration failure is handled inside the function itself and never
      // throws, so list() stays usable even when one legacy task is stuck.
      await migrateLegacyLocalStorageTasks(redirectToLogin);
      const response = await fetch("/api/tasks");
      guardUnauthorized(response, redirectToLogin);
      if (!response.ok) throw new Error("Failed to load tasks.");
      return (await response.json()) as Task[];
    },
    async create(task) {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      guardUnauthorized(response, redirectToLogin);
      if (!response.ok) throw new Error("Failed to save task.");
    },
    async update(task) {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      guardUnauthorized(response, redirectToLogin);
      if (!response.ok) throw new Error("Failed to save task.");
    },
    async remove(id) {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      guardUnauthorized(response, redirectToLogin);
      if (!response.ok) throw new Error("Failed to delete task.");
      await parseJsonOrUndefined(response);
    },
  };
}
