import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Subtask } from "../types";

export const SUBTASK_TRANSITION_DURATION_MS = 200;

type SectionPhase = "exit" | "enter";

interface SectionTransition {
  phase: SectionPhase;
  oldDone: boolean;
}

export interface SubtaskRenderState {
  // The done value to render with — during a section-move exit phase this
  // lags behind the real `done` on purpose (see startSectionExit below).
  done: boolean;
  // A brand-new subtask id (not present last render) plays this once.
  enterAnimationClass?: string;
  // In the drawer's active/completed grouping, a subtask moving between
  // sections when `done` toggles plays this — exit from the old section,
  // then enter into the new one. Unused by the flat (non-drawer) list,
  // which never regroups by done and would just flicker in place.
  sectionAnimationClass?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Two independent animations for a task's subtask list, mirroring
// useTaskTransitionClasses's delayed exit/enter technique (see that file
// for the full flicker-prevention rationale) at subtask scale:
// - a subtask id that wasn't present last render plays a one-shot enter;
// - a subtask whose `done` flips gets its section-move delayed just long
//   enough to play exit-then-enter, instead of teleporting between the
//   drawer's active/completed groups on the very next render.
//
// Deleting a subtask is deliberately NOT handled here — it's driven locally
// in each row component instead (see DrawerSubtaskRow), since the delete
// button click already knows exactly which row is leaving; reconciling a
// removed id back into its old list position from a prop diff alone would
// need the same array-order bookkeeping this hook is trying to avoid.
export function useSubtaskTransitionClasses(subtasks: Subtask[]): Map<string, SubtaskRenderState> {
  const [entering, setEntering] = useState<Set<string>>(new Set());
  const [sectionMoves, setSectionMoves] = useState<Map<string, SectionTransition>>(new Map());
  const prevDoneRef = useRef<Map<string, boolean> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function clearTimer(key: string) {
    const timer = timersRef.current.get(key);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(key);
  }

  function clearEnter(id: string) {
    timersRef.current.delete(`enter:${id}`);
    setEntering((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function startEnter(id: string) {
    setEntering((prev) => new Set(prev).add(id));
    timersRef.current.set(`enter:${id}`, setTimeout(() => clearEnter(id), SUBTASK_TRANSITION_DURATION_MS));
  }

  function clearSectionMove(id: string) {
    timersRef.current.delete(`section:${id}`);
    setSectionMoves((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function startSectionEnter(id: string) {
    setSectionMoves((prev) => {
      const current = prev.get(id);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(id, { ...current, phase: "enter" });
      return next;
    });
    timersRef.current.set(
      `section:${id}`,
      setTimeout(() => clearSectionMove(id), SUBTASK_TRANSITION_DURATION_MS),
    );
  }

  function startSectionExit(id: string, oldDone: boolean) {
    clearTimer(`section:${id}`);
    setSectionMoves((prev) => new Map(prev).set(id, { phase: "exit", oldDone }));
    timersRef.current.set(
      `section:${id}`,
      setTimeout(() => startSectionEnter(id), SUBTASK_TRANSITION_DURATION_MS),
    );
  }

  // Runs before paint so a just-toggled subtask's corrective "still in the
  // old section" render commits before the browser ever paints the
  // post-toggle snapped state — same reasoning as useTaskTransitionClasses.
  useIsomorphicLayoutEffect(() => {
    const prevDone = prevDoneRef.current;
    if (prevDone && !prefersReducedMotion()) {
      for (const s of subtasks) {
        const previous = prevDone.get(s.id);
        if (previous === undefined) {
          startEnter(s.id);
        } else if (previous !== s.done) {
          startSectionExit(s.id, previous);
        }
      }
    }
    prevDoneRef.current = new Map(subtasks.map((s) => [s.id, s.done]));
    // Same reasoning as useTaskTransitionClasses: these closures only touch
    // refs and stable setters, and `subtasks` is a new array every render
    // regardless, so the dependency array doesn't need anything else.
  }, [subtasks]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const result = new Map<string, SubtaskRenderState>();
  for (const s of subtasks) {
    const move = sectionMoves.get(s.id);
    result.set(s.id, {
      done: move?.phase === "exit" ? move.oldDone : s.done,
      enterAnimationClass: entering.has(s.id) ? "animate-subtask-enter" : undefined,
      sectionAnimationClass: move
        ? move.phase === "exit"
          ? "animate-subtask-exit"
          : "animate-subtask-enter"
        : undefined,
    });
  }
  return result;
}
