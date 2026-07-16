import type { Task } from "../types";

const STORAGE_KEY = "picking-up.tasks.v1";

const SCOPE_KINDS = ["day", "week", "month", "year"] as const;

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export interface TaskRepository {
  list(): Promise<Task[]>;
  create(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  remove(id: string): Promise<void>;
}

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  const scope = t.scope as Record<string, unknown> | undefined;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.done === "boolean" &&
    typeof t.createdAt === "string" &&
    typeof scope === "object" &&
    scope !== null &&
    SCOPE_KINDS.includes(scope.kind as (typeof SCOPE_KINDS)[number])
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
      return parsed.filter(isTask);
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
