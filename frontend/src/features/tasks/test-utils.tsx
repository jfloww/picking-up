import type { TaskRepository } from "./data/repository";
import type { Task } from "./types";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

export function fakeRepository(
  initial: Task[] = [],
): TaskRepository & { tasks: Task[] } {
  const state = { tasks: [...initial] };
  return {
    get tasks() {
      return state.tasks;
    },
    async list() {
      return [...state.tasks];
    },
    async create(task) {
      state.tasks = [...state.tasks, task];
    },
    async update(task) {
      state.tasks = state.tasks.map((t) => (t.id === task.id ? task : t));
    },
    async remove(id) {
      state.tasks = state.tasks.filter((t) => t.id !== id);
    },
  };
}
