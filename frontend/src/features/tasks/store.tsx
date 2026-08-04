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
import type { TaskRepository } from "./data/repository";
import { todayKey, weekStartOf } from "./lib/dates";
import { dayTasksForWeek, isValidTime } from "./lib/times";
import { rolloverTasks } from "./lib/rollover";
import { materializeRoutines } from "./lib/routines";
import type { Category, Scope, Task } from "./types";

const SYNC_ERROR_MESSAGE = "Something didn't save. Reconnecting to check what's saved…";

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
  | { type: "categoryAdded"; category: Category }
  | { type: "categoryUpdated"; category: Category }
  | { type: "syncErrorOccurred" }
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
      return { ...state, syncError: SYNC_ERROR_MESSAGE };
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

  function handleSyncFailure() {
    dispatch({ type: "syncErrorOccurred" });
    // A single outage typically fails several writes at once (every rolled
    // and spawned task on load); without this guard each one would kick off
    // its own full resync — and for the API repository every resync re-runs
    // the entire legacy-migration upload loop.
    if (resyncingRef.current) return;
    resyncingRef.current = true;
    void repo
      .list()
      .then((tasks) => dispatch({ type: "loaded", tasks }))
      .catch(() => {
        // Already surfaced via syncErrorOccurred above; a second
        // consecutive failure just leaves the banner up rather than
        // compounding into an unhandled rejection.
      })
      .finally(() => {
        resyncingRef.current = false;
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
        dispatch({ type: "loaded", tasks: finalTasks, categories });
        appliedDayRef.current = today;
        rolled.forEach((task, i) => {
          if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
        });
        spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "syncErrorOccurred" });
        dispatch({ type: "loaded", tasks: [], categories: [] });
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
      dispatch({ type: "loaded", tasks: finalTasks });
      appliedDayRef.current = today;
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
      });
      spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
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
        const order =
          scope.kind === "day"
            ? Math.max(
                0,
                ...state.tasks
                  .filter(
                    (t) =>
                      t.scope.kind === "day" &&
                      t.scope.date === scope.date &&
                      !t.time &&
                      !t.done,
                  )
                  .map((t) => t.order),
              ) + 1
            : 0;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          order,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
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
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
      toggleTask(id) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = {
          ...current,
          done: !current.done,
          completedAt: current.done ? undefined : new Date().toISOString(),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setMemo(id, memo) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setTime(id, time) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        if (time !== undefined && !isValidTime(time)) return;
        const task: Task = { ...current, time };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setRepeatWeekdays(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = {
          ...current,
          repeatWeekdays: normalized,
          dueDate: normalized ? undefined : current.dueDate,
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      detachFromRoutine(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = { ...current, repeatSourceId: undefined, repeatWeekdays: normalized };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);

        if (current.repeatSourceId !== undefined && current.scope.kind === "day") {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), current.scope.date];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
      },
      rescheduleTaskToDay(id, date) {
        const current = state.tasks.find((t) => t.id === id);
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
              ...dayTasksForWeek(state.tasks, date, weekStartOf(date))
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
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);

        if (current.repeatSourceId !== undefined) {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), originalDate];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
      },
      setPriority(id, priority) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, priority };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setDuration(id, durationMinutes) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, durationMinutes };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setBackground(id, background) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, background };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setDueDate(id, dueDate) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, dueDate };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setOrder(id, order) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, order };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setCategory(id, categoryId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current || current.scope.kind !== "bucket" || !categoryId) return;
        const task: Task = { ...current, scope: { kind: "bucket", categoryId } };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
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
        const current = state.tasks.find((t) => t.id === id);
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
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      toggleSubtask(id, subtaskId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, done: !s.done } : s,
          ),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      removeSubtask(id, subtaskId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.filter((s) => s.id !== subtaskId),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      editSubtaskTitle(id, subtaskId, title) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, title: trimmed } : s,
          ),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      removeTask(id) {
        const current = state.tasks.find((t) => t.id === id);
        dispatch({ type: "removed", id });
        repo.remove(id).catch(handleSyncFailure);

        // Deleting a spawned occurrence must tell its anchor not to
        // re-spawn it — otherwise the next load's materializeRoutines()
        // sees no same-day occurrence and recreates it, "resurrecting" a
        // task the user just deleted. Same excludedDates handling as
        // detachFromRoutine/rescheduleTaskToDay above.
        if (current?.repeatSourceId !== undefined && current.scope.kind === "day") {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), current.scope.date];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
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
