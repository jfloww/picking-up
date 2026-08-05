# Daily Done Today Transition Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Daily-view task is checked or unchecked, its card fades/slides out of its current section and fades/slides into its new section, instead of snapping instantly between "All Day To-Do"/"Next Up" and "Done Today".

**Architecture:** Two new CSS keyframe animations (`--animate-task-exit`/`--animate-task-enter`) alongside the existing `--animate-task-complete` in `globals.css`, plus a new local hook `useTaskTransitionClasses` that briefly delays a task's *rendered* section membership after its `done` value changes — long enough to play the exit animation in the old section before the enter animation plays in the new one. `day-agenda.tsx` is the only component that changes; the store's `toggleTask` and its API sync are untouched.

**Tech Stack:** Next.js/React 19, Tailwind CSS v4 (existing `--animate-*` custom-property convention), Vitest + `@testing-library/react` (existing test stack) — no new dependencies.

## Global Constraints

- **Daily view only.** No changes to Weekly, Monthly, or Bucket List views.
- **No new dependency** — plain CSS `@keyframes` + a small React timing hook, not framer-motion or any animation library.
- **Persistence is not delayed.** `toggleTask`'s store update and `repo.update(...)` API sync (`store.tsx:259-269`) fire immediately and are never touched by this plan. Only rendering of section membership is delayed.
- **Only genuine transitions animate.** A task already done when the page loads must render into "Done Today" with no enter animation.
- **Undo is symmetric** — unchecking a "Done Today" task plays the same exit/enter pair moving it back to "All Day To-Do" or "Next Up".
- **Transition duration is 260ms** for both the exit and enter phases (matches the existing `task-complete-pop`'s order of magnitude).

---

### Task 1: `useTaskTransitionClasses` hook + CSS keyframes

**Files:**
- Modify: `frontend/src/app/globals.css`
- Create: `frontend/src/features/tasks/components/use-task-transition-classes.ts`
- Test: `frontend/src/features/tasks/components/use-task-transition-classes.test.ts`

**Interfaces:**
- Produces: `useTaskTransitionClasses(dayTasks: Task[]): Map<string, TaskRenderState>` where `TaskRenderState = { done: boolean; animationClass?: string }`. `done` is the task's *rendered* done state (which briefly lags the real `task.done` during an exit); `animationClass` is `"animate-task-exit"`, `"animate-task-enter"`, or `undefined`. Task 2 calls this with `dayTasks` (the same array `day-agenda.tsx` already derives at line 41) and uses the result to decide section membership and apply a className per card.
- Consumes: `Task` from `../types` (existing).

- [ ] **Step 1: Write the failing test for initial mount (no animation)**

Create `frontend/src/features/tasks/components/use-task-transition-classes.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { useTaskTransitionClasses } from "./use-task-transition-classes";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskTransitionClasses", () => {
  it("returns each task's live done state with no animation class on initial mount", () => {
    const a = makeTask({ id: "a", done: false });
    const b = makeTask({ id: "b", done: true });
    const { result } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [a, b] },
    });
    expect(result.current.get("a")).toEqual({ done: false });
    expect(result.current.get("b")).toEqual({ done: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-task-transition-classes.test.ts`
Expected: FAIL — cannot find module `./use-task-transition-classes`.

- [ ] **Step 3: Add the CSS keyframes**

In `frontend/src/app/globals.css`, add two custom properties directly after the existing `--animate-task-complete` line (134):

```css
  --animate-task-complete: task-complete-pop 220ms ease-out;
  --animate-task-exit: task-exit 260ms ease-in both;
  --animate-task-enter: task-enter 260ms ease-out both;
```

Add the matching keyframes directly after the existing `@keyframes task-complete-pop` block:

```css
@keyframes task-exit {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
}

@keyframes task-enter {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

- [ ] **Step 4: Write a minimal stub implementation**

Create `frontend/src/features/tasks/components/use-task-transition-classes.ts`:

```ts
import type { Task } from "../types";

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
  const result = new Map<string, TaskRenderState>();
  for (const task of dayTasks) {
    result.set(task.id, { done: task.done });
  }
  return result;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-task-transition-classes.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing tests for the exit → enter → clear timeline and mid-transition restart**

Append to `frontend/src/features/tasks/components/use-task-transition-classes.test.ts`, inside the existing `describe` block:

```ts
  it("holds the old done value with an exit class right after done flips, then flips to the new value with an enter class, then clears", () => {
    const task = makeTask({ id: "t", done: false });
    const { result, rerender } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [task] },
    });
    expect(result.current.get("t")).toEqual({ done: false });

    rerender({ tasks: [{ ...task, done: true }] });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: true, animationClass: "animate-task-enter" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: true });
  });

  it("restarts the transition from the current state when toggled again mid-animation", () => {
    const task = makeTask({ id: "t", done: false });
    const { result, rerender } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [task] },
    });

    rerender({ tasks: [{ ...task, done: true }] });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(100); // still mid-exit
    });
    rerender({ tasks: [{ ...task, done: false }] }); // toggled back before the exit finished
    expect(result.current.get("t")).toEqual({ done: true, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-enter" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false });
  });
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-task-transition-classes.test.ts`
Expected: FAIL — the stub never sets an `animationClass`, so both new tests fail on the first assertion after `rerender`.

- [ ] **Step 8: Implement the full transition state machine**

Replace the body of `frontend/src/features/tasks/components/use-task-transition-classes.ts`:

```ts
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
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-task-transition-classes.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/features/tasks/components/use-task-transition-classes.ts frontend/src/features/tasks/components/use-task-transition-classes.test.ts
git commit -m "feat: add task-exit/task-enter animation keyframes and transition hook"
```

---

### Task 2: Wire the transition hook into `DayAgenda`

**Files:**
- Modify: `frontend/src/features/tasks/components/day-agenda.tsx`
- Test: `frontend/src/features/tasks/components/day-agenda.test.tsx`

**Interfaces:**
- Consumes: `useTaskTransitionClasses(dayTasks: Task[]): Map<string, TaskRenderState>` from Task 1, where `TaskRenderState = { done: boolean; animationClass?: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/components/day-agenda.test.tsx`, as a new `describe` block after the existing `"DayAgenda reorder handle"` block:

```tsx
describe("DayAgenda done-today transition animation", () => {
  it("does not animate a task that is already done on initial mount", async () => {
    const t = makeTask({ id: "d", title: "already done", done: true, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("already done")).toBeTruthy());
    const card = screen.getByTestId("agenda-d");
    expect(card.className).not.toContain("animate-task-enter");
    expect(card.className).not.toContain("animate-task-exit");
  });

  it("plays an exit animation in the old section right after checking a task, then an enter animation in Done Today", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Toggle water plants"));

    // still rendered in All Day To-Do, playing the exit animation
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.getByTestId("agenda-u").className).toContain("animate-task-exit");
    expect(screen.queryByText("Done Today")).toBeNull();

    // lands in Done Today playing the enter animation
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy(), { timeout: 1000 });
    expect(screen.getByTestId("agenda-u").className).toContain("animate-task-enter");

    // settles with no animation class once the transition finishes
    await waitFor(
      () => expect(screen.getByTestId("agenda-u").className).not.toContain("animate-task-enter"),
      { timeout: 1000 },
    );
  });

  it("mirrors the animation when unchecking a Done Today task back to All Day To-Do", async () => {
    const t = makeTask({ id: "d", title: "done item", done: true, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Toggle done item"));

    expect(screen.getByText("Done Today")).toBeTruthy();
    expect(screen.getByTestId("agenda-d").className).toContain("animate-task-exit");

    await waitFor(() => expect(screen.getByText("All Day To-Do")).toBeTruthy(), { timeout: 1000 });
    expect(screen.getByTestId("agenda-d").className).toContain("animate-task-enter");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: FAIL — the second and third tests fail because today `task.done` flips synchronously with no delay, so `screen.getByText("All Day To-Do")` (or `"Done Today"`) is already gone by the time it's asserted right after the click, and no `animate-task-exit`/`animate-task-enter` class exists anywhere yet.

- [ ] **Step 3: Wire the hook into `day-agenda.tsx`**

In `frontend/src/features/tasks/components/day-agenda.tsx`, update the import block (lines 1-13):

```tsx
"use client";

import { GripVertical } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { todayKey } from "../lib/dates";
import { computeOrderBetween } from "../lib/reorder";
import { compareTasksForDay, isPastToday, nowTime } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import { useDragToReorder } from "./use-drag-to-reorder";
import { useTaskTransitionClasses } from "./use-task-transition-classes";
```

Replace the filter block (lines 37-47):

```tsx
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);

  const transitions = useTaskTransitionClasses(dayTasks);
  const isDone = (t: Task) => transitions.get(t.id)?.done ?? t.done;

  const allDayToDo = [...dayTasks.filter((t) => !t.time && !isDone(t))].sort(
    (a, b) => a.order - b.order,
  );
  const nextUp = [...dayTasks.filter((t) => !!t.time && !isDone(t))].sort(compareTasksForDay);
  const doneToday = dayTasks.filter((t) => isDone(t));
```

In `renderCard`, update the card wrapper's `className` (currently `className="flex touch-none items-center gap-1.5"`, around line 104):

```tsx
          className={cn("flex touch-none items-center gap-1.5", transitions.get(t.id)?.animationClass)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: PASS (all tests in the file, including the pre-existing ones — the `isDone` helper matches plain `t.done` whenever no transition is in flight, so no other test's assertions change)

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — no regressions in `task-item.test.tsx`, `day-timeline.test.tsx`, or elsewhere that render `DayAgenda`/`TaskItem`.

- [ ] **Step 6: Manual verification in the browser**

Start the dev server (`cd frontend && npm run dev`, serves on `http://localhost:10050`) and open the Daily view:
- Check an "All Day To-Do" task: it should fade/slide out in place, then fade/slide into "Done Today" moments later — not an instant jump.
- Check a "Next Up" task: same, and unchecking it from "Done Today" returns it to "Next Up" with the mirrored animation.
- Uncheck an "All Day To-Do"-origin task from "Done Today": mirrored animation back to "All Day To-Do".
- Click a checkbox rapidly several times in a row: no stuck, duplicated, or visually glitched cards.
- Reload the page with some tasks already done: "Done Today" renders immediately with no enter animation.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-agenda.test.tsx
git commit -m "feat: animate task cards moving into and out of Done Today"
```
