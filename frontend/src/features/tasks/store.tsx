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

import { createApiTaskRepository } from "./data/api-task-repository";
import type { TaskRepository } from "./data/repository";
import { todayKey } from "./lib/dates";
import { isValidTime } from "./lib/times";
import { rolloverTasks } from "./lib/rollover";
import { materializeRoutines } from "./lib/routines";
import type { Scope, Task } from "./types";

const SYNC_ERROR_MESSAGE = "Something didn't save. Reconnecting to check what's saved…";

export interface TasksState {
  loaded: boolean;
  tasks: Task[];
  syncError: string | null;
}

export type TasksAction =
  | { type: "loaded"; tasks: Task[] }
  | { type: "added"; task: Task }
  | { type: "updated"; task: Task }
  | { type: "removed"; id: string }
  | { type: "syncErrorOccurred" }
  | { type: "syncErrorDismissed" };

export function tasksReducer(
  state: TasksState,
  action: TasksAction,
): TasksState {
  switch (action.type) {
    case "loaded":
      return { ...state, loaded: true, tasks: action.tasks };
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
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
  dismissSyncError: () => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({
  repository,
  children,
}: {
  repository?: TaskRepository;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(tasksReducer, {
    loaded: false,
    tasks: [],
    syncError: null,
  });
  const repo = useMemo(
    () => repository ?? createApiTaskRepository(),
    [repository],
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
    void repo
      .list()
      .then((tasks) => {
        if (cancelled) return;
        const today = todayKey();
        const rolled = rolloverTasks(tasks, today);
        const spawned = materializeRoutines(rolled, today);
        const finalTasks = [...rolled, ...spawned];
        dispatch({ type: "loaded", tasks: finalTasks });
        appliedDayRef.current = today;
        rolled.forEach((task, i) => {
          if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
        });
        spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "syncErrorOccurred" });
        dispatch({ type: "loaded", tasks: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

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
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
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
        if (!current || current.scope.kind !== "day") return;
        if (current.scope.date === date) return;

        const originalDate = current.scope.date;
        const task: Task = { ...current, scope: { kind: "day", date } };
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
      removeTask(id) {
        dispatch({ type: "removed", id });
        repo.remove(id).catch(handleSyncFailure);
      },
      dismissSyncError() {
        dispatch({ type: "syncErrorDismissed" });
      },
    }),
    [state, repo],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext);
  if (!context) throw new Error("useTasks must be used within TasksProvider");
  return context;
}
