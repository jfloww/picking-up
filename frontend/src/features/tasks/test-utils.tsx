import type { CategoryRepository } from "./data/category-repository";
import { TaskVersionConflictError, type TaskRepository } from "./data/repository";
import { promotedSubtaskOrder } from "./lib/reorder";
import type { Category, Task } from "./types";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    order: 0,
    version: 1,
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
      const created = { ...task, version: 1 };
      state.tasks = [...state.tasks, created];
      return created;
    },
    async update(task) {
      const current = state.tasks.find((item) => item.id === task.id);
      if (!current || current.version !== task.version) throw new TaskVersionConflictError();
      const updated = { ...task, version: task.version + 1 };
      state.tasks = state.tasks.map((t) => (t.id === task.id ? updated : t));
      return updated;
    },
    async remove(id, version) {
      const current = state.tasks.find((item) => item.id === id);
      if (!current || current.version !== version) throw new TaskVersionConflictError();
      state.tasks = state.tasks.filter((t) => t.id !== id);
    },
    async nestTask(command) {
      const source = state.tasks.find((task) => task.id === command.sourceId);
      const target = state.tasks.find((task) => task.id === command.targetId);
      if (
        !source ||
        !target ||
        source.version !== command.sourceVersion ||
        target.version !== command.targetVersion
      ) {
        throw new TaskVersionConflictError();
      }
      const updatedTarget: Task = {
        ...target,
        version: target.version + 1,
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done },
        ],
      };
      state.tasks = state.tasks
        .filter((task) => task.id !== source.id)
        .map((task) => (task.id === target.id ? updatedTarget : task));
      return { target: updatedTarget, removedTaskId: source.id };
    },
    async promoteSubtask(command) {
      const parent = state.tasks.find((task) => task.id === command.parentId);
      if (!parent || parent.version !== command.parentVersion) {
        throw new TaskVersionConflictError();
      }
      const subtask = parent.subtasks?.find((item) => item.id === command.subtaskId);
      if (!subtask) throw new Error("Subtask not found.");

      const order = promotedSubtaskOrder(state.tasks, parent);

      const now = new Date().toISOString();
      const task: Task = {
        id: command.newTaskId,
        title: subtask.title,
        done: subtask.done,
        scope: parent.scope,
        createdAt: now,
        completedAt: subtask.done ? now : undefined,
        order,
        version: 1,
      };
      const updatedParent: Task = {
        ...parent,
        subtasks: parent.subtasks?.filter((item) => item.id !== command.subtaskId),
        version: parent.version + 1,
      };
      state.tasks = [
        ...state.tasks.map((item) => (item.id === parent.id ? updatedParent : item)),
        task,
      ];
      return { parent: updatedParent, task };
    },
    async detachTask(command) {
      const occurrence = state.tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      const updatedOccurrence: Task = {
        ...occurrence,
        version: occurrence.version + 1,
        repeatSourceId: undefined,
        repeatWeekdays:
          command.repeatWeekdays && command.repeatWeekdays.length > 0
            ? command.repeatWeekdays
            : undefined,
      };
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date =
            occurrence.scope.kind === "day"
              ? occurrence.scope.date
              : occurrence.scope.kind === "week" && occurrence.rolledFrom?.kind === "day"
                ? occurrence.rolledFrom.date
                : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      state.tasks = state.tasks.map((t) => {
        if (t.id === updatedOccurrence.id) return updatedOccurrence;
        if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
        return t;
      });
      return updatedAnchor
        ? { occurrence: updatedOccurrence, anchor: updatedAnchor }
        : { occurrence: updatedOccurrence };
    },
    async deleteOccurrence(command) {
      const occurrence = state.tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date =
            occurrence.scope.kind === "day"
              ? occurrence.scope.date
              : occurrence.scope.kind === "week" && occurrence.rolledFrom?.kind === "day"
                ? occurrence.rolledFrom.date
                : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      state.tasks = state.tasks
        .filter((t) => t.id !== occurrence.id)
        .map((t) => (updatedAnchor && t.id === updatedAnchor.id ? updatedAnchor : t));
      return updatedAnchor
        ? { removedTaskId: occurrence.id, anchor: updatedAnchor }
        : { removedTaskId: occurrence.id };
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
