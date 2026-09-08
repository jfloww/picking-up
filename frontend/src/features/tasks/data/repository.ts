import { weekStartOf } from "../lib/dates";
import { computeOrderBetween, promotedSubtaskOrder } from "../lib/reorder";
import { dayTasksForWeek, isValidTime } from "../lib/times";
import type { Subtask, Task } from "../types";

export const STORAGE_KEY = "picking-up.tasks.v1";

const SCOPE_FIELDS = {
  day: "date",
  week: "weekStart",
  month: "month",
  year: "year",
  bucket: "categoryId",
} as const;

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export interface NestTaskCommand {
  sourceId: string;
  targetId: string;
  sourceVersion: number;
  targetVersion: number;
  subtaskId: string;
  confirmDataLoss: boolean;
}

export interface NestTaskResult {
  target: Task;
  removedTaskId: string;
}

export interface PromoteSubtaskCommand {
  parentId: string;
  subtaskId: string;
  parentVersion: number;
  newTaskId: string;
}

export interface PromoteSubtaskResult {
  parent: Task;
  task: Task;
}

export interface DetachTaskCommand {
  occurrenceId: string;
  occurrenceVersion: number;
}

export interface DetachTaskResult {
  occurrence: Task;
  anchor?: Task;
}

export interface DeleteOccurrenceCommand {
  occurrenceId: string;
  occurrenceVersion: number;
}

export interface DeleteOccurrenceResult {
  removedTaskId: string;
  anchor?: Task;
}

export interface RescheduleTaskCommand {
  taskId: string;
  taskVersion: number;
  date: string;
}

export interface RescheduleTaskResult {
  task: Task;
  anchor?: Task;
}

export interface ReorderTaskCommand {
  taskId: string;
  taskVersion: number;
  insertBeforeId: string | null;
}

export interface ReorderTaskResult {
  task: Task;
}

export class TaskVersionConflictError extends Error {
  // RF-005 review finding: the server's 409 body carries a machine code and
  // (for a genuine staleness conflict) the task's current version, so a
  // caller can distinguish "someone else changed this" from a client-side
  // programming error and could resync just the affected task instead of
  // treating every conflict as an undifferentiated failure. Both are
  // optional because not every conflict source provides them (the
  // localStorage/fake repositories below construct this with neither).
  readonly code: string;
  readonly currentVersions?: Record<string, number>;

  constructor(code = "task_version_conflict", currentVersions?: Record<string, number>) {
    super("The task changed after it was loaded.");
    this.name = "TaskVersionConflictError";
    this.code = code;
    this.currentVersions = currentVersions;
  }
}

export interface TaskRepository {
  list(): Promise<Task[]>;
  create(task: Task): Promise<Task>;
  update(task: Task): Promise<Task>;
  remove(id: string, version: number): Promise<void>;
  nestTask(command: NestTaskCommand): Promise<NestTaskResult>;
  promoteSubtask(command: PromoteSubtaskCommand): Promise<PromoteSubtaskResult>;
  detachTask(command: DetachTaskCommand): Promise<DetachTaskResult>;
  deleteOccurrence(command: DeleteOccurrenceCommand): Promise<DeleteOccurrenceResult>;
  rescheduleTask(command: RescheduleTaskCommand): Promise<RescheduleTaskResult>;
  reorderTask(command: ReorderTaskCommand): Promise<ReorderTaskResult>;
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

function isValidDateList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((d) => typeof d === "string");
}

// The read path normalizes v2 fields instead of rejecting the whole task:
// only v1 structural validation (isTask/isScope) may drop a task.
export function normalizeTask(task: Task): Task {
  const version = Number.isSafeInteger(task.version) && task.version >= 1 ? task.version : 1;
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

  let excludedDates = task.excludedDates;
  if (excludedDates !== undefined && !isValidDateList(excludedDates)) {
    excludedDates = undefined;
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
    excludedDates === task.excludedDates &&
    priority === task.priority &&
    durationMinutes === task.durationMinutes &&
    background === task.background &&
    version === task.version
  ) {
    return task;
  }
  return {
    ...task,
    time,
    subtasks,
    repeatWeekdays,
    repeatSourceId,
    excludedDates,
    priority,
    durationMinutes,
    background,
    version,
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
      const created = { ...task, version: 1 };
      write([...read(), created]);
      return created;
    },
    async update(task) {
      const tasks = read();
      const current = tasks.find((t) => t.id === task.id);
      if (!current || current.version !== task.version) throw new TaskVersionConflictError();
      const updated = { ...task, version: task.version + 1 };
      write(tasks.map((t) => (t.id === task.id ? updated : t)));
      return updated;
    },
    async remove(id, version) {
      const tasks = read();
      const current = tasks.find((t) => t.id === id);
      if (!current || current.version !== version) throw new TaskVersionConflictError();
      write(tasks.filter((t) => t.id !== id));
    },
    async nestTask(command) {
      const tasks = read();
      const source = tasks.find((t) => t.id === command.sourceId);
      const target = tasks.find((t) => t.id === command.targetId);
      if (
        !source ||
        !target ||
        source.version !== command.sourceVersion ||
        target.version !== command.targetVersion
      ) {
        throw new TaskVersionConflictError();
      }
      if (source.id === target.id) throw new Error("A task cannot be nested into itself.");
      if ((source.subtasks?.length ?? 0) > 0) {
        throw new Error("A task with subtasks cannot be nested.");
      }
      if (
        (source.repeatWeekdays?.length ?? 0) > 0 ||
        source.repeatSourceId ||
        tasks.some((task) => task.repeatSourceId === source.id)
      ) {
        throw new Error("A routine task must be detached before nesting.");
      }
      if (target.subtasks?.some((subtask) => subtask.id === command.subtaskId)) {
        throw new Error("The subtask id already exists on the target.");
      }
      const losesTaskOnlyData = Boolean(
        source.time ||
          source.durationMinutes ||
          source.priority ||
          source.dueDate ||
          source.background ||
          source.rolledFrom ||
          (source.excludedDates?.length ?? 0) > 0,
      );
      if (losesTaskOnlyData && !command.confirmDataLoss) {
        throw new Error("Nesting requires explicit data-loss confirmation.");
      }
      const updatedTarget: Task = {
        ...target,
        version: target.version + 1,
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done, memo: source.memo },
        ],
      };
      write(
        tasks
          .filter((task) => task.id !== source.id)
          .map((task) => (task.id === target.id ? updatedTarget : task)),
      );
      return { target: updatedTarget, removedTaskId: source.id };
    },
    async promoteSubtask(command) {
      const tasks = read();
      const parent = tasks.find((task) => task.id === command.parentId);
      if (!parent || parent.version !== command.parentVersion) {
        throw new TaskVersionConflictError();
      }
      const matchingSubtasks =
        parent.subtasks?.filter((item) => item.id === command.subtaskId) ?? [];
      if (matchingSubtasks.length !== 1) throw new Error("Subtask not found or ambiguous.");
      if (tasks.some((task) => task.id === command.newTaskId)) {
        throw new Error("The promoted task id already exists.");
      }
      const subtask = matchingSubtasks[0]!;

      const order = promotedSubtaskOrder(tasks, parent);

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
      write([...tasks.map((item) => (item.id === parent.id ? updatedParent : item)), task]);
      return { parent: updatedParent, task };
    },
    async detachTask(command) {
      const tasks = read();
      const occurrence = tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      const updatedOccurrence: Task = {
        ...occurrence,
        version: occurrence.version + 1,
        repeatSourceId: undefined,
        repeatWeekdays: undefined,
      };
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = tasks.find((t) => t.id === anchorId);
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
      write(
        tasks.map((t) => {
          if (t.id === updatedOccurrence.id) return updatedOccurrence;
          if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
          return t;
        }),
      );
      return updatedAnchor
        ? { occurrence: updatedOccurrence, anchor: updatedAnchor }
        : { occurrence: updatedOccurrence };
    },
    async deleteOccurrence(command) {
      const tasks = read();
      const occurrence = tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = tasks.find((t) => t.id === anchorId);
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
      write(
        tasks
          .filter((t) => t.id !== occurrence.id)
          .map((t) => (updatedAnchor && t.id === updatedAnchor.id ? updatedAnchor : t)),
      );
      return updatedAnchor
        ? { removedTaskId: occurrence.id, anchor: updatedAnchor }
        : { removedTaskId: occurrence.id };
    },
    async rescheduleTask(command) {
      const tasks = read();
      const task = tasks.find((t) => t.id === command.taskId);
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
        const anchor = tasks.find((t) => t.id === anchorId);
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
            ...dayTasksForWeek(tasks, command.date, weekStartOf(command.date))
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

      write(
        tasks.map((t) => {
          if (t.id === updatedTask.id) return updatedTask;
          if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
          return t;
        }),
      );
      return updatedAnchor ? { task: updatedTask, anchor: updatedAnchor } : { task: updatedTask };
    },
    async reorderTask(command) {
      const tasks = read();
      const task = tasks.find((t) => t.id === command.taskId);
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
      const siblings = dayTasksForWeek(tasks, date, weekStartOf(date))
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
      write(tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
      return { task: updatedTask };
    },
  };
}
