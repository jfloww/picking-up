import type { Task } from "../types";
import { createLocalStorageRepository, STORAGE_KEY, type TaskRepository } from "./repository";

async function parseJsonOrUndefined<T>(response: Response): Promise<T | undefined> {
  if (response.status === 204) return undefined;
  return response.json();
}

async function uploadForMigration(task: Task): Promise<void> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (response.ok || response.status === 409) return;
  throw new Error(`Failed to migrate task ${task.id}.`);
}

async function migrateLegacyLocalStorageTasks(): Promise<void> {
  const legacyTasks = await createLocalStorageRepository().list();
  if (legacyTasks.length === 0) return;
  for (const task of legacyTasks) {
    await uploadForMigration(task);
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

export function createApiTaskRepository(): TaskRepository {
  return {
    async list() {
      try {
        await migrateLegacyLocalStorageTasks();
      } catch (error) {
        // Migration failed for a reason other than "already exists" (a
        // dangling repeatSourceId from a deleted anchor, an over-length
        // title, etc). localStorage is left intact so a later attempt can
        // retry, but the app must stay usable in the meantime rather than
        // permanently blocking on a stuck migration.
        console.error("Failed to migrate legacy local tasks; will retry on next load.", error);
      }
      const response = await fetch("/api/tasks");
      if (!response.ok) throw new Error("Failed to load tasks.");
      return (await response.json()) as Task[];
    },
    async create(task) {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      if (!response.ok) throw new Error("Failed to save task.");
    },
    async update(task) {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      if (!response.ok) throw new Error("Failed to save task.");
    },
    async remove(id) {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete task.");
      await parseJsonOrUndefined(response);
    },
  };
}
