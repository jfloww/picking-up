import type { CategoryRepository } from "./data/category-repository";
import type { TaskRepository } from "./data/repository";
import type { Category, Task } from "./types";

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

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: crypto.randomUUID(),
    name: "category",
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

export function fakeCategoryRepository(
  initial: Category[] = [],
): CategoryRepository & { categories: Category[] } {
  const state = { categories: [...initial] };
  return {
    get categories() {
      return state.categories;
    },
    async list() {
      return [...state.categories];
    },
    async create(name) {
      const existing = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const category: Category = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
      state.categories = [...state.categories, category];
      return category;
    },
    async rename(id, name) {
      const category = state.categories.find((c) => c.id === id);
      if (!category) throw new Error("Category not found.");
      const renamed = { ...category, name };
      state.categories = state.categories.map((c) => (c.id === id ? renamed : c));
      return renamed;
    },
  };
}
