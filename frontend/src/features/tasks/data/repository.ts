import { isValidTime } from "../lib/times";
import type { Subtask, Task } from "../types";

const STORAGE_KEY = "picking-up.tasks.v1";

const SCOPE_FIELDS = {
  day: "date",
  week: "weekStart",
  month: "month",
  year: "year",
} as const;

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export interface TaskRepository {
  list(): Promise<Task[]>;
  create(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  remove(id: string): Promise<void>;
}

function isScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const field = SCOPE_FIELDS[s.kind as keyof typeof SCOPE_FIELDS];
  return field !== undefined && typeof s[field] === "string";
}

function isSubtask(value: unknown): value is Subtask {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.done === "boolean"
  );
}

function isValidWeekdays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  );
}

// The read path normalizes v2 fields instead of rejecting the whole task:
// only v1 structural validation (isTask/isScope) may drop a task.
export function normalizeTask(task: Task): Task {
  let time = task.time;
  if (time !== undefined && (typeof time !== "string" || !isValidTime(time))) {
    time = undefined;
  }

  let subtasks = task.subtasks;
  if (subtasks !== undefined) {
    if (Array.isArray(subtasks)) {
      const filtered = subtasks.filter(isSubtask);
      subtasks = filtered.length === subtasks.length ? subtasks : filtered;
    } else {
      subtasks = undefined;
    }
  }

  let repeatWeekdays = task.repeatWeekdays;
  if (repeatWeekdays !== undefined && !isValidWeekdays(repeatWeekdays)) {
    repeatWeekdays = undefined;
  }

  let repeatSourceId = task.repeatSourceId;
  if (repeatSourceId !== undefined && typeof repeatSourceId !== "string") {
    repeatSourceId = undefined;
  }

  let priority = task.priority;
  if (priority !== undefined && typeof priority !== "boolean") {
    priority = undefined;
  }

  let durationMinutes = task.durationMinutes;
  if (
    durationMinutes !== undefined &&
    (typeof durationMinutes !== "number" ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0)
  ) {
    durationMinutes = undefined;
  }

  let background = task.background;
  if (background !== undefined && typeof background !== "boolean") {
    background = undefined;
  }

  if (
    time === task.time &&
    subtasks === task.subtasks &&
    repeatWeekdays === task.repeatWeekdays &&
    repeatSourceId === task.repeatSourceId &&
    priority === task.priority &&
    durationMinutes === task.durationMinutes &&
    background === task.background
  ) {
    return task;
  }
  return {
    ...task,
    time,
    subtasks,
    repeatWeekdays,
    repeatSourceId,
    priority,
    durationMinutes,
    background,
  };
}

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.done === "boolean" &&
    typeof t.createdAt === "string" &&
    isScope(t.scope)
  );
}

export function createLocalStorageRepository(
  storage?: TaskStorage,
): TaskRepository {
  // Resolved lazily so the factory can run during SSR without touching window.
  const store = () => storage ?? window.localStorage;

  const read = (): Task[] => {
    try {
      const raw = store().getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isTask).map(normalizeTask);
    } catch {
      return [];
    }
  };

  const write = (tasks: Task[]) =>
    store().setItem(STORAGE_KEY, JSON.stringify(tasks));

  return {
    async list() {
      return read();
    },
    async create(task) {
      write([...read(), task]);
    },
    async update(task) {
      write(read().map((t) => (t.id === task.id ? task : t)));
    },
    async remove(id) {
      write(read().filter((t) => t.id !== id));
    },
  };
}
