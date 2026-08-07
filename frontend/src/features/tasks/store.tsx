"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { createApiCategoryRepository } from "./data/category-repository";
import type { CategoryRepository } from "./data/category-repository";
import { createApiTaskRepository } from "./data/api-task-repository";
import { TaskVersionConflictError, type TaskRepository } from "./data/repository";
import { todayKey, weekStartOf } from "./lib/dates";
import { dayTasksForWeek, isValidTime } from "./lib/times";
import { rolloverTasks } from "./lib/rollover";
import { materializeRoutines } from "./lib/routines";
import { nestBlockReasonFor } from "./lib/nesting";
import { nextUntimedOrderFor, promotedSubtaskOrder } from "./lib/reorder";
import type { Category, Scope, Subtask, Task } from "./types";

const SYNC_ERROR_MESSAGE = "Something didn't save. Reconnecting to check what's saved…";
// RF-005 review finding: a version conflict means the server has newer
// truth for this task specifically (someone else — another tab, another
// device — changed it), not a generic connectivity problem. The recovery
// action is the same resync either way, but the message it left the user
// with used to say exactly the same thing for both cases.
const CONFLICT_ERROR_MESSAGE = "A task changed elsewhere. Refreshing to show the latest…";

type MutableTaskKey = Exclude<
  keyof Task,
  "id" | "createdAt" | "subtasks" | "version" | "excludedDates"
>;

const MUTABLE_TASK_KEYS = [
  "title",
  "memo",
  "done",
  "scope",
  "rolledFrom",
  "completedAt",
  "time",
  "repeatWeekdays",
  "repeatSourceId",
  "priority",
  "durationMinutes",
  "background",
  "dueDate",
  "order",
] as const satisfies readonly MutableTaskKey[];

type TaskValuePatch = Partial<Pick<Task, MutableTaskKey>>;

interface SubtaskUpsert {
  value: Subtask;
  requiresExisting: boolean;
}

interface TaskPatch {
  values: TaskValuePatch;
  // Every store mutation that touches excludedDates only ever appends the
  // one date it just detached/rescheduled/deleted away from an anchor —
  // recorded as an addition set (like the subtask upserts below) rather
  // than the whole resulting array, so rebasing unions onto whatever the
  // authoritative anchor's excludedDates holds after reconciliation
  // instead of overwriting it and silently dropping another writer's
  // exclusion (PR#52 review finding).
  excludedDatesAdded?: string[];
  subtasks?: {
    upserts: SubtaskUpsert[];
    removedIds: string[];
    keepEmptyArray: boolean;
  };
}

function buildTaskPatch(before: Task, after: Task): TaskPatch {
  const values = {} as TaskValuePatch;
  for (const key of MUTABLE_TASK_KEYS) {
    if (!Object.is(before[key], after[key])) {
      (values as Record<MutableTaskKey, unknown>)[key] = after[key];
    }
  }

  const patch: TaskPatch = { values };

  if (!Object.is(before.excludedDates, after.excludedDates)) {
    const beforeExcluded = new Set(before.excludedDates ?? []);
    const added = (after.excludedDates ?? []).filter((date) => !beforeExcluded.has(date));
    if (added.length > 0) patch.excludedDatesAdded = added;
  }

  if (Object.is(before.subtasks, after.subtasks)) return patch;

  const beforeSubtasks = before.subtasks ?? [];
  const afterSubtasks = after.subtasks ?? [];
  const beforeById = new Map(beforeSubtasks.map((subtask) => [subtask.id, subtask]));
  const afterIds = new Set(afterSubtasks.map((subtask) => subtask.id));

  patch.subtasks = {
    upserts: afterSubtasks
      .filter((subtask) => !Object.is(beforeById.get(subtask.id), subtask))
      .map((subtask) => ({
        value: subtask,
        requiresExisting: beforeById.has(subtask.id),
      })),
    removedIds: beforeSubtasks
      .filter((subtask) => !afterIds.has(subtask.id))
      .map((subtask) => subtask.id),
    keepEmptyArray: after.subtasks !== undefined,
  };
  return patch;
}

function applyTaskPatch(base: Task, patch: TaskPatch): Task | undefined {
  let changed = false;
  const values = {} as TaskValuePatch;
  for (const key of MUTABLE_TASK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch.values, key)) {
      const value = patch.values[key];
      if (!Object.is(base[key], value)) {
        (values as Record<MutableTaskKey, unknown>)[key] = value;
        changed = true;
      }
    }
  }

  let excludedDates = base.excludedDates;
  if (patch.excludedDatesAdded && patch.excludedDatesAdded.length > 0) {
    const existing = new Set(base.excludedDates ?? []);
    const additions = patch.excludedDatesAdded.filter((date) => !existing.has(date));
    if (additions.length > 0) {
      excludedDates = [...(base.excludedDates ?? []), ...additions];
      changed = true;
    }
  }

  let subtasks = base.subtasks;
  if (patch.subtasks) {
    const next = [...(base.subtasks ?? [])];
    const removedIds = new Set(patch.subtasks.removedIds);
    if (removedIds.size > 0) {
      const kept = next.filter((subtask) => !removedIds.has(subtask.id));
      if (kept.length !== next.length) {
        next.splice(0, next.length, ...kept);
        changed = true;
      }
    }

    for (const upsert of patch.subtasks.upserts) {
      const index = next.findIndex((subtask) => subtask.id === upsert.value.id);
      if (index >= 0) {
        if (!Object.is(next[index], upsert.value)) {
          next[index] = upsert.value;
          changed = true;
        }
      } else if (!upsert.requiresExisting) {
        next.push(upsert.value);
        changed = true;
      }
    }

    if (changed || (patch.subtasks.keepEmptyArray && base.subtasks === undefined)) {
      subtasks = next;
      changed = true;
    }
  }

  if (!changed) return undefined;
  return { ...base, ...values, excludedDates, subtasks };
}

export interface TasksState {
  loaded: boolean;
  tasks: Task[];
  categories: Category[];
  syncError: string | null;
}

export type TasksAction =
  | { type: "loaded"; tasks: Task[]; categories?: Category[] }
  | { type: "added"; task: Task }
  | { type: "updated"; task: Task }
  | { type: "removed"; id: string }
  | { type: "commandApplied"; upserts: Task[]; removedIds: string[] }
  | { type: "categoryAdded"; category: Category }
  | { type: "categoryUpdated"; category: Category }
  | { type: "syncErrorOccurred"; message?: string }
  | { type: "syncErrorDismissed" };

export function tasksReducer(
  state: TasksState,
  action: TasksAction,
): TasksState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        loaded: true,
        tasks: action.tasks,
        categories: action.categories ?? state.categories,
      };
    case "added":
      return { ...state, tasks: [...state.tasks, action.task] };
    case "updated":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.task.id ? action.task : t,
        ),
      };
    case "removed":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case "commandApplied": {
      const removedIds = new Set(action.removedIds);
      const upserts = new Map(action.upserts.map((task) => [task.id, task]));
      const tasks = state.tasks
        .filter((task) => !removedIds.has(task.id))
        .map((task) => upserts.get(task.id) ?? task);
      const existingIds = new Set(tasks.map((task) => task.id));
      for (const task of action.upserts) {
        if (!existingIds.has(task.id)) tasks.push(task);
      }
      return { ...state, tasks };
    }
    case "categoryAdded":
      return { ...state, categories: [...state.categories, action.category] };
    case "categoryUpdated":
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.category.id ? action.category : c,
        ),
      };
    case "syncErrorOccurred":
      return { ...state, syncError: action.message ?? SYNC_ERROR_MESSAGE };
    case "syncErrorDismissed":
      return { ...state, syncError: null };
  }
}

interface TasksContextValue extends TasksState {
  addTask: (title: string, scope: Scope) => Task | undefined;
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  detachFromRoutine: (id: string, weekdays?: number[]) => void;
  rescheduleTaskToDay: (id: string, date: string) => void;
  setPriority: (id: string, priority: boolean) => void;
  setDuration: (id: string, durationMinutes: number | undefined) => void;
  setBackground: (id: string, background: boolean) => void;
  setDueDate: (id: string, dueDate: string | undefined) => void;
  setOrder: (id: string, order: number) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  convertTaskToSubtask: (
    id: string,
    targetId: string,
    confirmDataLoss?: boolean,
  ) => void;
  promoteSubtaskToTask: (id: string, subtaskId: string) => Task | undefined;
  addBucketItem: (title: string, categoryId: string) => Task | undefined;
  setCategory: (id: string, categoryId: string) => void;
  createCategory: (name: string) => Promise<Category | undefined>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  dismissSyncError: () => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({
  repository,
  categoryRepository,
  children,
}: {
  repository?: TaskRepository;
  categoryRepository?: CategoryRepository;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(tasksReducer, {
    loaded: false,
    tasks: [],
    categories: [],
    syncError: null,
  });
  const repo = useMemo(
    () => repository ?? createApiTaskRepository(),
    [repository],
  );
  const categoryRepo = useMemo(
    () => categoryRepository ?? createApiCategoryRepository(),
    [categoryRepository],
  );

  const tasksRef = useRef(state.tasks);
  tasksRef.current = state.tasks;
  const appliedDayRef = useRef<string | null>(null);
  const resyncingRef = useRef(false);
  const resyncPromiseRef = useRef<Promise<void> | null>(null);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const authoritativeVersionsRef = useRef(new Map<string, number>());
  const authoritativeTasksRef = useRef(new Map<string, Task>());
  const mutationGenerationsRef = useRef(new Map<string, number>());

  function replaceTaskState(task: Task) {
    tasksRef.current = tasksRef.current.map((current) =>
      current.id === task.id ? task : current,
    );
    dispatch({ type: "updated", task });
  }

  function addTaskState(task: Task) {
    tasksRef.current = [...tasksRef.current, task];
    dispatch({ type: "added", task });
  }

  function removeTaskState(id: string) {
    tasksRef.current = tasksRef.current.filter((task) => task.id !== id);
    dispatch({ type: "removed", id });
  }

  function applyCommandState(upserts: Task[], removedIds: string[]) {
    const removed = new Set(removedIds);
    const byId = new Map(upserts.map((task) => [task.id, task]));
    const tasks = tasksRef.current
      .filter((task) => !removed.has(task.id))
      .map((task) => byId.get(task.id) ?? task);
    const existingIds = new Set(tasks.map((task) => task.id));
    for (const task of upserts) {
      if (!existingIds.has(task.id)) tasks.push(task);
    }
    tasksRef.current = tasks;
    dispatch({ type: "commandApplied", upserts, removedIds });
  }

  function replaceLoadedTasks(
    tasks: Task[],
    categories?: Category[],
    authoritativeTasks: Task[] = tasks,
  ) {
    tasksRef.current = tasks;
    authoritativeVersionsRef.current = new Map(
      authoritativeTasks.map((task) => [task.id, task.version]),
    );
    authoritativeTasksRef.current = new Map(
      authoritativeTasks.map((task) => [task.id, task]),
    );
    dispatch({ type: "loaded", tasks, categories });
  }

  function nextMutationGeneration(id: string): number {
    const generation = (mutationGenerationsRef.current.get(id) ?? 0) + 1;
    mutationGenerationsRef.current.set(id, generation);
    return generation;
  }

  function handleSyncFailure(message = SYNC_ERROR_MESSAGE): Promise<void> {
    dispatch({ type: "syncErrorOccurred", message });
    // A single outage typically fails several writes at once (every rolled
    // and spawned task on load); without this guard each one would kick off
    // its own full resync — and for the API repository every resync re-runs
    // the entire legacy-migration upload loop.
    if (resyncingRef.current) return resyncPromiseRef.current ?? Promise.resolve();
    resyncingRef.current = true;
    const resync = repo
      .list()
      .then((tasks) => replaceLoadedTasks(tasks))
      .catch(() => {
        // Already surfaced via syncErrorOccurred above; a second
        // consecutive failure just leaves the banner up rather than
        // compounding into an unhandled rejection.
      })
      .finally(() => {
        resyncingRef.current = false;
        resyncPromiseRef.current = null;
      });
    resyncPromiseRef.current = resync;
    return resync;
  }

  function enqueueMutation(operation: () => Promise<void>) {
    // A failed optimistic command must be reconciled before a dependent
    // mutation is allowed to write. Each generic update stores a field/subtask
    // delta (buildTaskPatch) and rebases that intent onto the authoritative
    // task after this resync, so waiting here no longer pairs a stale full
    // payload with a newly fetched version.
    mutationQueueRef.current = mutationQueueRef.current
      .then(async () => {
        try {
          await operation();
        } catch (error) {
          // Only a genuine staleness conflict ("someone else changed this")
          // gets the conflict-specific message. A command can also 409 for a
          // domain-rule rejection (nesting a task into itself, a target that
          // already has subtasks, ...) via the same TaskVersionConflictError
          // type — those aren't a staleness conflict and showing "changed
          // elsewhere" for them would be a new, incorrect claim (final-review
          // finding on this fix).
          await handleSyncFailure(
            error instanceof TaskVersionConflictError && error.code === "task_version_conflict"
              ? CONFLICT_ERROR_MESSAGE
              : SYNC_ERROR_MESSAGE,
          );
        }
      })
      // Insurance, not the expected path: everything above already has its
      // own try/catch, but if something still throws here (dispatch itself
      // failing, a bug in handleSyncFailure), an uncaught rejection would
      // make mutationQueueRef.current permanently rejected — every mutation
      // enqueued afterward for the rest of the session would then silently
      // skip its callback via .then()'s rejection passthrough, with no
      // banner and no error, since a .then() without a second argument
      // never runs on a rejected chain (PR#52 review finding).
      .catch(() => {});
  }

  function persistUpdate(
    task: Task,
    previous = tasksRef.current.find((candidate) => candidate.id === task.id),
  ) {
    if (!previous) return;
    const patch = buildTaskPatch(previous, task);
    const generation = nextMutationGeneration(task.id);
    replaceTaskState(task);
    enqueueMutation(async () => {
      const authoritative = authoritativeTasksRef.current.get(task.id);
      if (!authoritative) return;
      const rebased = applyTaskPatch(authoritative, patch);
      if (!rebased) return;
      const saved = await repo.update(rebased);
      authoritativeVersionsRef.current.set(saved.id, saved.version);
      authoritativeTasksRef.current.set(saved.id, saved);

      const current = tasksRef.current.find((candidate) => candidate.id === saved.id);
      if (!current) return;
      const reconciled =
        mutationGenerationsRef.current.get(saved.id) === generation
          ? saved
          : { ...current, version: saved.version };
      replaceTaskState(reconciled);
    });
  }

  function persistCreate(task: Task, alreadyApplied = false) {
    const generation = nextMutationGeneration(task.id);
    authoritativeVersionsRef.current.set(task.id, task.version);
    if (!alreadyApplied) addTaskState(task);
    enqueueMutation(async () => {
      const saved = await repo.create(task);
      authoritativeVersionsRef.current.set(saved.id, saved.version);
      authoritativeTasksRef.current.set(saved.id, saved);

      const current = tasksRef.current.find((candidate) => candidate.id === saved.id);
      if (!current) {
        addTaskState(saved);
        return;
      }
      const reconciled =
        mutationGenerationsRef.current.get(saved.id) === generation
          ? saved
          : { ...current, version: saved.version };
      replaceTaskState(reconciled);
    });
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([repo.list(), categoryRepo.list()])
      .then(([tasks, categories]) => {
        if (cancelled) return;
        const today = todayKey();
        const rolled = rolloverTasks(tasks, today);
        const spawned = materializeRoutines(rolled, today);
        const finalTasks = [...rolled, ...spawned];
        replaceLoadedTasks(finalTasks, categories, tasks);
        appliedDayRef.current = today;
        rolled.forEach((task, i) => {
          if (task !== tasks[i]) persistUpdate(task, tasks[i]);
        });
        spawned.forEach((task) => persistCreate(task, true));
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "syncErrorOccurred" });
        replaceLoadedTasks([], []);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, categoryRepo]);

  useEffect(() => {
    function rolloverIfDateChanged() {
      if (appliedDayRef.current === null) return;
      const today = todayKey();
      if (today === appliedDayRef.current) return;
      const tasks = tasksRef.current;
      const rolled = rolloverTasks(tasks, today);
      const spawned = materializeRoutines(rolled, today);
      const finalTasks = [...rolled, ...spawned];
      replaceLoadedTasks(finalTasks, undefined, tasks);
      appliedDayRef.current = today;
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) persistUpdate(task, tasks[i]);
      });
      spawned.forEach((task) => persistCreate(task, true));
    }

    window.addEventListener("focus", rolloverIfDateChanged);
    document.addEventListener("visibilitychange", rolloverIfDateChanged);
    return () => {
      window.removeEventListener("focus", rolloverIfDateChanged);
      document.removeEventListener("visibilitychange", rolloverIfDateChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ...state,
      addTask(title, scope) {
        const trimmed = title.trim();
        if (!trimmed) return undefined;
        const order = scope.kind === "day" ? nextUntimedOrderFor(tasksRef.current, scope.date) : 0;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          order,
          createdAt: new Date().toISOString(),
          version: 1,
        };
        persistCreate(task);
        return task;
      },
      addBucketItem(title, categoryId) {
        const trimmed = title.trim();
        if (!trimmed || !categoryId) return undefined;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope: { kind: "bucket", categoryId },
          order: 0,
          createdAt: new Date().toISOString(),
          version: 1,
        };
        persistCreate(task);
        return task;
      },
      toggleTask(id) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = {
          ...current,
          done: !current.done,
          completedAt: current.done ? undefined : new Date().toISOString(),
        };
        persistUpdate(task);
      },
      setMemo(id, memo) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        persistUpdate(task);
      },
      setTime(id, time) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        if (time !== undefined && !isValidTime(time)) return;
        const task: Task = { ...current, time };
        persistUpdate(task);
      },
      setRepeatWeekdays(id, weekdays) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = {
          ...current,
          repeatWeekdays: normalized,
          dueDate: normalized ? undefined : current.dueDate,
        };
        persistUpdate(task);
      },
      detachFromRoutine(id, weekdays) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const anchorId = current.repeatSourceId;

        const updatedOccurrence: Task = {
          ...current,
          repeatSourceId: undefined,
          repeatWeekdays: normalized,
        };
        const occurrenceGeneration = nextMutationGeneration(current.id);
        const anchorGeneration = anchorId ? nextMutationGeneration(anchorId) : undefined;

        // Optimistically mirror the anchor's excludedDates update so the UI
        // reflects the detach immediately, same as every other
        // anchor-touching mutation in this store. Uses the same broader
        // effective-date rule as the authoritative repo.detachTask
        // implementations (repository.ts/test-utils.tsx) and
        // rescheduleTaskToDay below: a plain day-scoped occurrence, or a
        // rolled-over week-scoped one, contributes its original day. The
        // authoritative anchor from the command response is applied once
        // the command resolves below, regardless of whether this
        // optimistic branch ran.
        let optimisticAnchor: Task | undefined;
        const originalDate =
          current.scope.kind === "day"
            ? current.scope.date
            : current.scope.kind === "week" && current.rolledFrom?.kind === "day"
              ? current.rolledFrom.date
              : undefined;
        if (anchorId !== undefined && originalDate !== undefined) {
          const anchor = tasksRef.current.find((t) => t.id === anchorId);
          if (anchor && !(anchor.excludedDates ?? []).includes(originalDate)) {
            optimisticAnchor = {
              ...anchor,
              excludedDates: [...(anchor.excludedDates ?? []), originalDate],
            };
          }
        }
        applyCommandState(
          optimisticAnchor ? [updatedOccurrence, optimisticAnchor] : [updatedOccurrence],
          [],
        );

        enqueueMutation(async () => {
          const result = await repo.detachTask({
            occurrenceId: current.id,
            occurrenceVersion: authoritativeVersionsRef.current.get(current.id) ?? current.version,
            repeatWeekdays: normalized,
          });
          authoritativeVersionsRef.current.set(result.occurrence.id, result.occurrence.version);
          authoritativeTasksRef.current.set(result.occurrence.id, result.occurrence);

          const currentOccurrence = tasksRef.current.find((t) => t.id === result.occurrence.id);
          const reconciledOccurrence =
            currentOccurrence &&
            mutationGenerationsRef.current.get(result.occurrence.id) !== occurrenceGeneration
              ? { ...currentOccurrence, version: result.occurrence.version }
              : result.occurrence;

          const upserts = [reconciledOccurrence];
          if (result.anchor) {
            authoritativeVersionsRef.current.set(result.anchor.id, result.anchor.version);
            authoritativeTasksRef.current.set(result.anchor.id, result.anchor);
            const currentAnchor = tasksRef.current.find((t) => t.id === result.anchor!.id);
            const reconciledAnchor =
              currentAnchor && anchorGeneration !== undefined &&
              mutationGenerationsRef.current.get(result.anchor.id) !== anchorGeneration
                ? { ...currentAnchor, version: result.anchor.version }
                : result.anchor;
            upserts.push(reconciledAnchor);
          }
          applyCommandState(upserts, []);
        });
      },
      rescheduleTaskToDay(id, date) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;

        let originalDate: string;
        if (current.scope.kind === "day") {
          originalDate = current.scope.date;
        } else if (current.scope.kind === "week" && current.rolledFrom?.kind === "day") {
          originalDate = current.rolledFrom.date;
        } else {
          return;
        }
        if (originalDate === date) return;

        // Carrying the old day's order value across would land an untimed
        // task at an arbitrary position in the new day's list, unrelated to
        // the user's intent — append it past the destination's existing
        // untimed tasks instead. A timed task's position is always driven
        // by `time`, not `order`, so its existing value is left as-is.
        //
        // The scan deliberately differs from addTask's: it goes through
        // dayTasksForWeek (the same source Weekly's own columns and its
        // reorder scan use) rather than plain scope.kind === "day" tasks,
        // and it does not exclude done tasks. Weekly renders untimed done
        // and not-done tasks interleaved in one order-sorted list, and
        // shows rolled-over week-scoped tasks in their original day's
        // column — so both are real siblings that must count towards "the
        // end of the list", or an appended task lands mid-column instead.
        // (addTask's own filter is left alone: Daily's list structure, with
        // its separate Done section, is different.)
        const order = current.time
          ? current.order
          : Math.max(
              0,
              ...dayTasksForWeek(tasksRef.current, date, weekStartOf(date))
                .filter((t) => !t.time)
                .map((t) => t.order),
            ) + 1;

        const task: Task = {
          ...current,
          scope: { kind: "day", date },
          rolledFrom: undefined,
          order,
        };
        if (current.repeatSourceId !== undefined) {
          task.repeatSourceId = undefined;
        }
        persistUpdate(task);

        if (current.repeatSourceId !== undefined) {
          const anchor = tasksRef.current.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), originalDate];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            persistUpdate(updatedAnchor);
          }
        }
      },
      setPriority(id, priority) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, priority };
        persistUpdate(task);
      },
      setDuration(id, durationMinutes) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, durationMinutes };
        persistUpdate(task);
      },
      setBackground(id, background) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, background };
        persistUpdate(task);
      },
      setDueDate(id, dueDate) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, dueDate };
        persistUpdate(task);
      },
      setOrder(id, order) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, order };
        persistUpdate(task);
      },
      setCategory(id, categoryId) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current || current.scope.kind !== "bucket" || !categoryId) return;
        const task: Task = { ...current, scope: { kind: "bucket", categoryId } };
        persistUpdate(task);
      },
      async createCategory(name) {
        const trimmed = name.trim();
        if (!trimmed) return undefined;
        try {
          const category = await categoryRepo.create(trimmed);
          // create-or-reuse: only dispatch if this category isn't already
          // in state (the server may have returned an existing match).
          if (!state.categories.some((c) => c.id === category.id)) {
            dispatch({ type: "categoryAdded", category });
          }
          return category;
        } catch {
          return undefined;
        }
      },
      async renameCategory(id, name) {
        const trimmed = name.trim();
        if (!trimmed) return false;
        try {
          const category = await categoryRepo.rename(id, trimmed);
          dispatch({ type: "categoryUpdated", category });
          return true;
        } catch {
          return false;
        }
      },
      addSubtask(id, title) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          ...current,
          subtasks: [
            ...(current.subtasks ?? []),
            { id: crypto.randomUUID(), title: trimmed, done: false },
          ],
        };
        persistUpdate(task);
      },
      toggleSubtask(id, subtaskId) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, done: !s.done } : s,
          ),
        };
        persistUpdate(task);
      },
      removeSubtask(id, subtaskId) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.filter((s) => s.id !== subtaskId),
        };
        persistUpdate(task);
      },
      editSubtaskTitle(id, subtaskId, title) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, title: trimmed } : s,
          ),
        };
        persistUpdate(task);
      },
      convertTaskToSubtask(id, targetId, confirmDataLoss = false) {
        // One repository command mirrors the optimistic two-entity state change.
        if (id === targetId) return;
        const source = tasksRef.current.find((t) => t.id === id);
        const target = tasksRef.current.find((t) => t.id === targetId);
        if (!source || !target) return;
        if (nestBlockReasonFor(source)) return;

        const subtaskId = crypto.randomUUID();
        const updatedTarget: Task = {
          ...target,
          subtasks: [
            ...(target.subtasks ?? []),
            { id: subtaskId, title: source.title, done: source.done },
          ],
        };
        const targetGeneration = nextMutationGeneration(target.id);
        nextMutationGeneration(source.id);
        applyCommandState([updatedTarget], [source.id]);

        enqueueMutation(async () => {
          const result = await repo.nestTask({
            sourceId: source.id,
            targetId: target.id,
            sourceVersion:
              authoritativeVersionsRef.current.get(source.id) ?? source.version,
            targetVersion:
              authoritativeVersionsRef.current.get(target.id) ?? target.version,
            subtaskId,
            confirmDataLoss,
          });
          authoritativeVersionsRef.current.delete(result.removedTaskId);
          authoritativeVersionsRef.current.set(result.target.id, result.target.version);
          authoritativeTasksRef.current.delete(result.removedTaskId);
          authoritativeTasksRef.current.set(result.target.id, result.target);

          const currentTarget = tasksRef.current.find(
            (task) => task.id === result.target.id,
          );
          const reconciledTarget =
            currentTarget &&
            mutationGenerationsRef.current.get(result.target.id) !== targetGeneration
              ? { ...currentTarget, version: result.target.version }
              : result.target;
          applyCommandState([reconciledTarget], [result.removedTaskId]);
        });
      },
      promoteSubtaskToTask(id, subtaskId) {
        const parent = tasksRef.current.find((t) => t.id === id);
        if (!parent?.subtasks) return undefined;
        const subtask = parent.subtasks.find((s) => s.id === subtaskId);
        if (!subtask) return undefined;

        const order = promotedSubtaskOrder(tasksRef.current, parent);

        const now = new Date().toISOString();
        const task: Task = {
          id: crypto.randomUUID(),
          title: subtask.title,
          done: subtask.done,
          scope: parent.scope,
          order,
          createdAt: now,
          completedAt: subtask.done ? now : undefined,
          version: 1,
        };
        const updatedParent: Task = {
          ...parent,
          subtasks: parent.subtasks.filter((s) => s.id !== subtaskId),
        };

        const parentGeneration = nextMutationGeneration(parent.id);
        const taskGeneration = nextMutationGeneration(task.id);
        authoritativeVersionsRef.current.set(task.id, task.version);
        applyCommandState([updatedParent, task], []);

        enqueueMutation(async () => {
          const result = await repo.promoteSubtask({
            parentId: parent.id,
            subtaskId,
            parentVersion:
              authoritativeVersionsRef.current.get(parent.id) ?? parent.version,
            newTaskId: task.id,
          });
          authoritativeVersionsRef.current.set(result.parent.id, result.parent.version);
          authoritativeVersionsRef.current.set(result.task.id, result.task.version);
          authoritativeTasksRef.current.set(result.parent.id, result.parent);
          authoritativeTasksRef.current.set(result.task.id, result.task);

          const currentParent = tasksRef.current.find(
            (candidate) => candidate.id === result.parent.id,
          );
          const currentTask = tasksRef.current.find(
            (candidate) => candidate.id === result.task.id,
          );
          const reconciledParent =
            currentParent &&
            mutationGenerationsRef.current.get(result.parent.id) !== parentGeneration
              ? { ...currentParent, version: result.parent.version }
              : result.parent;
          const reconciledTask =
            currentTask &&
            mutationGenerationsRef.current.get(result.task.id) !== taskGeneration
              ? { ...currentTask, version: result.task.version }
              : result.task;
          applyCommandState([reconciledParent, reconciledTask], []);
        });

        return task;
      },
      removeTask(id) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        nextMutationGeneration(id);
        const anchorId = current.repeatSourceId;

        if (anchorId === undefined) {
          removeTaskState(id);
          enqueueMutation(async () => {
            const version = authoritativeVersionsRef.current.get(id) ?? current.version;
            await repo.remove(id, version);
            authoritativeVersionsRef.current.delete(id);
            authoritativeTasksRef.current.delete(id);
          });
          return;
        }

        // Deleting a spawned occurrence must tell its anchor not to
        // re-spawn it — otherwise the next load's materializeRoutines()
        // sees no same-day occurrence and recreates it, "resurrecting" a
        // task the user just deleted. This is folded into the same
        // deleteOccurrence command below so the removal and the anchor's
        // excludedDates update are atomic, but the anchor is also mirrored
        // optimistically here (before the command resolves) using the same
        // "day-scope or rolled-over week-scope" effective-date rule as
        // detachFromRoutine/rescheduleTaskToDay, so the UI reflects it
        // immediately.
        const anchorGeneration = nextMutationGeneration(anchorId);
        let optimisticAnchor: Task | undefined;
        const originalDate =
          current.scope.kind === "day"
            ? current.scope.date
            : current.scope.kind === "week" && current.rolledFrom?.kind === "day"
              ? current.rolledFrom.date
              : undefined;
        if (originalDate !== undefined) {
          const anchor = tasksRef.current.find((t) => t.id === anchorId);
          if (anchor && !(anchor.excludedDates ?? []).includes(originalDate)) {
            optimisticAnchor = {
              ...anchor,
              excludedDates: [...(anchor.excludedDates ?? []), originalDate],
            };
          }
        }
        applyCommandState(optimisticAnchor ? [optimisticAnchor] : [], [id]);

        enqueueMutation(async () => {
          const result = await repo.deleteOccurrence({
            occurrenceId: id,
            occurrenceVersion: authoritativeVersionsRef.current.get(id) ?? current.version,
          });
          authoritativeVersionsRef.current.delete(result.removedTaskId);
          authoritativeTasksRef.current.delete(result.removedTaskId);

          if (result.anchor) {
            authoritativeVersionsRef.current.set(result.anchor.id, result.anchor.version);
            authoritativeTasksRef.current.set(result.anchor.id, result.anchor);
            const currentAnchor = tasksRef.current.find((t) => t.id === result.anchor!.id);
            const reconciledAnchor =
              currentAnchor &&
              mutationGenerationsRef.current.get(result.anchor.id) !== anchorGeneration
                ? { ...currentAnchor, version: result.anchor.version }
                : result.anchor;
            applyCommandState([reconciledAnchor], []);
          }
        });
      },
      dismissSyncError() {
        dispatch({ type: "syncErrorDismissed" });
      },
    }),
    [state, repo, categoryRepo],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext);
  if (!context) throw new Error("useTasks must be used within TasksProvider");
  return context;
}
