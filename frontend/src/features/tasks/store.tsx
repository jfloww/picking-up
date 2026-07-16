"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { createLocalStorageRepository, type TaskRepository } from "./data/repository";
import { todayKey } from "./lib/dates";
import { rolloverTasks } from "./lib/rollover";
import type { Scope, Task } from "./types";

export interface TasksState {
  loaded: boolean;
  tasks: Task[];
}

export type TasksAction =
  | { type: "loaded"; tasks: Task[] }
  | { type: "added"; task: Task }
  | { type: "updated"; task: Task }
  | { type: "removed"; id: string };

export function tasksReducer(
  state: TasksState,
  action: TasksAction,
): TasksState {
  switch (action.type) {
    case "loaded":
      return { loaded: true, tasks: action.tasks };
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
  }
}

interface TasksContextValue extends TasksState {
  addTask: (title: string, scope: Scope) => void;
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  removeTask: (id: string) => void;
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
  });
  const repo = useMemo(
    () => repository ?? createLocalStorageRepository(),
    [repository],
  );

  useEffect(() => {
    let cancelled = false;
    void repo.list().then((tasks) => {
      if (cancelled) return;
      const rolled = rolloverTasks(tasks, todayKey());
      dispatch({ type: "loaded", tasks: rolled });
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) void repo.update(task);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ...state,
      addTask(title, scope) {
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        void repo.create(task);
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
        void repo.update(task);
      },
      setMemo(id, memo) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
      removeTask(id) {
        dispatch({ type: "removed", id });
        void repo.remove(id);
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
