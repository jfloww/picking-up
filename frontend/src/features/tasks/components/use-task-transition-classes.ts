import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

// `useLayoutEffect` is a no-op (with a console warning) during SSR, and
// DayAgenda is a "use client" component that Next.js can still prerender —
// fall back to `useEffect` when there's no `window`.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    timersRef.current.delete(id);
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
    // Reduced motion: skip the delayed transition entirely and let the
    // task move sections on the very next render, same as if it had no
    // entry in the map at all. A CSS-only opt-out isn't enough here since
    // the JS-driven delay itself (not just the animation) is what would
    // hold the card in the wrong section.
    if (prefersReducedMotion()) return;

    clearTimer(id);
    setEntries((prev) => {
      const current = prev.get(id);
      // An exit already in flight is animating out of a specific section;
      // keep animating out of that one instead of teleporting the card
      // through whatever section the live store value implies.
      const from = current?.phase === "exit" ? current.oldDone : oldDone;
      return new Map(prev).set(id, { phase: "exit", oldDone: from });
    });
    timersRef.current.set(
      id,
      setTimeout(() => startEnter(id), TRANSITION_DURATION_MS),
    );
  }

  // Runs before paint (not after, like a plain effect) so the corrective
  // "still in the old section, playing the exit animation" render commits
  // before the browser ever paints the post-toggle snapped state — that
  // one-frame snap-then-correct is exactly the flicker this feature exists
  // to remove.
  useIsomorphicLayoutEffect(() => {
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
    // startExit/startEnter/clearEntry only close over refs and the stable
    // setEntries setter, never render-scoped values — and dayTasks is a
    // new array every render anyway, so this effect already re-runs every
    // render regardless of what's in its deps. (No eslint-disable needed
    // here: react-hooks/exhaustive-deps only checks the hooks it imports
    // directly, and doesn't statically follow the `useIsomorphicLayoutEffect`
    // alias, so it doesn't flag this dependency array at all.)
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
