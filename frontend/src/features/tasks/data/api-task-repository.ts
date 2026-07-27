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
      await migrateLegacyLocalStorageTasks();
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
