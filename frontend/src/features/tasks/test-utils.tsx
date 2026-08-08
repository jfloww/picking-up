import type { CategoryRepository } from "./data/category-repository";
import { TaskVersionConflictError, type TaskRepository } from "./data/repository";
import { weekStartOf } from "./lib/dates";
import { computeOrderBetween, promotedSubtaskOrder } from "./lib/reorder";
import { dayTasksForWeek } from "./lib/times";
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
          { id: command.subtaskId, title: source.title, done: source.done, memo: source.memo },
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
        memo: subtask.memo,
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
    async rescheduleTask(command) {
      const task = state.tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const currentDate =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (currentDate === undefined) {
        throw new Error("Only a day-scoped or rolled-over week-scoped task can be rescheduled.");
      }
      if (currentDate === command.date) {
        throw new Error("The task is already scheduled on this date.");
      }

      let updatedAnchor: Task | undefined;
      const anchorId = task.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor = existing.has(currentDate)
            ? anchor
            : { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), currentDate] };
        }
      }

      const order = task.time
        ? task.order
        : Math.max(
            0,
            ...dayTasksForWeek(state.tasks, command.date, weekStartOf(command.date))
              .filter((t) => !t.time)
              .map((t) => t.order),
          ) + 1;

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        scope: { kind: "day", date: command.date },
        rolledFrom: undefined,
        repeatSourceId: undefined,
        order,
      };

      state.tasks = state.tasks.map((t) => {
        if (t.id === updatedTask.id) return updatedTask;
        if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
        return t;
      });
      return updatedAnchor ? { task: updatedTask, anchor: updatedAnchor } : { task: updatedTask };
    },
    async reorderTask(command) {
      const task = state.tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const date =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (task.time || date === undefined) {
        throw new Error("Only an untimed day-scoped or rolled-over week-scoped task can be reordered.");
      }
      const siblings = dayTasksForWeek(state.tasks, date, weekStartOf(date))
        .filter((t) => !t.time && t.id !== task.id)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

      let before: Task | undefined;
      let after: Task | undefined;
      if (command.insertBeforeId === null) {
        before = siblings[siblings.length - 1];
        after = undefined;
      } else {
        const matchIndex = siblings.findIndex((t) => t.id === command.insertBeforeId);
        if (matchIndex === -1) {
          throw new Error("The neighbor task is not a valid insertion point.");
        }
        after = siblings[matchIndex];
        before = matchIndex > 0 ? siblings[matchIndex - 1] : undefined;
      }

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        order: computeOrderBetween(before?.order, after?.order),
      };
      state.tasks = state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
      return { task: updatedTask };
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
