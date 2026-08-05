import { useEffect, useRef, useState } from "react";

import type { Task } from "../types";

const TRANSITION_DURATION_MS = 260;

type Phase = "exit" | "enter";

interface TransitionEntry {
  phase: Phase;
  oldDone: boolean;
}

export interface TaskRenderState {
  done: boolean;
  animationClass?: string;
}

// Delays a task's move between DayAgenda's filtered sections just long
// enough to play a fade/slide animation, instead of the live `task.done`
// flip removing it from its old section on the very next render. Only
// applied to `done` changes that happen after mount — tasks already done
// when the page loads render into "Done Today" with no animation.
export function useTaskTransitionClasses(dayTasks: Task[]): Map<string, TaskRenderState> {
  const [entries, setEntries] = useState<Map<string, TransitionEntry>>(new Map());
  const prevDoneRef = useRef<Map<string, boolean> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function clearTimer(id: string) {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
  }

  function clearEntry(id: string) {
    timersRef.current.delete(id);
    setEntries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function startEnter(id: string) {
    setEntries((prev) => {
      const current = prev.get(id);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(id, { ...current, phase: "enter" });
      return next;
    });
    timersRef.current.set(
      id,
      setTimeout(() => clearEntry(id), TRANSITION_DURATION_MS),
    );
  }

  function startExit(id: string, oldDone: boolean) {
    clearTimer(id);
    setEntries((prev) => new Map(prev).set(id, { phase: "exit", oldDone }));
    timersRef.current.set(
      id,
      setTimeout(() => startEnter(id), TRANSITION_DURATION_MS),
    );
  }

  useEffect(() => {
    const prevDone = prevDoneRef.current;
    if (prevDone) {
      for (const task of dayTasks) {
        const previous = prevDone.get(task.id);
        if (previous !== undefined && previous !== task.done) {
          startExit(task.id, previous);
        }
      }
    }
    prevDoneRef.current = new Map(dayTasks.map((t) => [t.id, t.done]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayTasks]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const result = new Map<string, TaskRenderState>();
  for (const task of dayTasks) {
    const entry = entries.get(task.id);
    if (!entry) {
      result.set(task.id, { done: task.done });
    } else if (entry.phase === "exit") {
      result.set(task.id, { done: entry.oldDone, animationClass: "animate-task-exit" });
    } else {
      result.set(task.id, { done: task.done, animationClass: "animate-task-enter" });
    }
  }
  return result;
}
