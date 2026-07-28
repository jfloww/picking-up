# Weekly Tab: Drag-to-Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a task card from one day's column to another in the Weekly tab, saving the new date immediately on drop.

**Architecture:** Four tasks, each independently testable. Task 1 builds a new pointer-gesture hook (`useDragToRescheduleDay`) that resolves a drop position to a day column, mirroring the existing `useDragToSchedule` hook's mechanics without touching it. Task 2 adds the store action that performs the move (detaching a repeat instance first, when relevant). Task 3 threads an optional drag-handlers prop through `ScopeTasks`. Task 4 wires all three together in `WeeklyView`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest + Testing Library, Pointer Events (no HTML5 Drag-and-Drop API, no new dependencies).

## Global Constraints

- Dragging moves a task to a different **day** only — no within-day reordering (this app has no persisted manual task order).
- `useDragToRescheduleDay` is a new, independent hook. Do **not** modify `frontend/src/features/tasks/components/use-drag-to-schedule.ts` in this plan.
- A repeat-generated instance (`repeatSourceId` set) detaches from its routine on drag, using the same shape `detachFromRoutine` already uses: clear `repeatSourceId` on the instance, and add the instance's *original* date (not the new one) to the anchor's `excludedDates`.
- `time` is preserved across the move — only `scope.date` changes.
- Dropping on the same day is a no-op: no state dispatch, no persistence call.
- Releasing outside every day column cancels the drag: nothing changes.
- The dragged card does not follow the pointer as a floating ghost (matching the existing Daily drag-to-schedule) — only the target day column gets a visual highlight while dragging.
- No changes to Monthly or Yearly views, and no auto-advancing to a different week by dragging to a grid edge.
- No new npm dependencies.

---

### Task 1: `useDragToRescheduleDay` hook

**Files:**
- Create: `frontend/src/features/tasks/components/use-drag-to-reschedule-day.ts`
- Test: `frontend/src/features/tasks/components/use-drag-to-reschedule-day.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks in this plan.
- Produces: `useDragToRescheduleDay(options: { columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>; onReschedule: (id: string, date: string) => void }): { dragState: { id: string; title: string; targetDate: string | null } | null; getDragHandlers: (id: string, title: string) => { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } }` — Task 4 wires this hook's `columnRefs` to real day-column DOM nodes and its `onReschedule` to Task 2's store action. Task 3 doesn't consume this hook directly, but its new `getDragHandlers` prop type must structurally match what this hook's `getDragHandlers` returns.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/tasks/components/use-drag-to-reschedule-day.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToRescheduleDay } from "./use-drag-to-reschedule-day";

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
    ...rect,
  } as DOMRect);
}

function Harness({ onReschedule }: { onReschedule: (id: string, date: string) => void }) {
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleDay({ columnRefs, onReschedule });

  return (
    <div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-13"] = el;
        }}
        data-testid="col-mon"
      >
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A")}>
          <button type="button" onClick={() => onReschedule("clicked-title", "irrelevant")}>
            Task A
          </button>
        </div>
      </div>
      {/* A second, unrelated draggable item that shares the same hook instance
          (and therefore the same suppressClickRef) as chip-a, but is never
          itself dragged in these tests — proves the suppression flag doesn't
          leak across wrappers. */}
      <div data-testid="chip-b" {...getDragHandlers("b", "Task B")}>
        <button type="button" onClick={() => onReschedule("clicked-title-b", "irrelevant")}>
          Task B
        </button>
      </div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-14"] = el;
        }}
        data-testid="col-tue"
      />
      <div data-testid="target">
        {dragState ? (dragState.targetDate ?? "none-over-a-column") : "not-dragging"}
      </div>
    </div>
  );
}

function setup(onReschedule = vi.fn()) {
  render(<Harness onReschedule={onReschedule} />);
  const colMon = screen.getByTestId("col-mon");
  const colTue = screen.getByTestId("col-tue");
  mockRect(colMon, { top: 0, bottom: 100, left: 0, right: 100 });
  mockRect(colTue, { top: 0, bottom: 100, left: 200, right: 300 });
  return { onReschedule, chip: screen.getByTestId("chip-a") };
}

describe("useDragToRescheduleDay", () => {
  it("does not reschedule on a plain click (no movement past the threshold)", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onReschedule).toHaveBeenCalledTimes(1);
    expect(onReschedule).toHaveBeenCalledWith("clicked-title", "irrelevant");
  });

  it("reschedules to the column dropped on, and shows that column's date while dragging", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 }); // over col-tue
    expect(screen.getByTestId("target").textContent).toBe("2026-07-14");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("is a no-op when dropped outside every column", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onReschedule).toHaveBeenCalledTimes(1); // only the reschedule call
    expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");
  });

  it("self-expires the click-suppression flag even if no click ever reaches onClickCapture (cross-column drop unmount)", () => {
    vi.useFakeTimers();
    try {
      const { onReschedule, chip } = setup();
      fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
      fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
      expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");

      vi.advanceTimersByTime(1);

      fireEvent.click(screen.getByRole("button", { name: "Task B" }));
      expect(onReschedule).toHaveBeenCalledWith("clicked-title-b", "irrelevant");
      expect(onReschedule).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not capture the pointer on a plain click (would break nested click handlers)", () => {
    const { chip } = setup();
    const captureSpy = vi.fn();
    chip.setPointerCapture = captureSpy;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the pointer once a real drag starts (movement past the threshold)", () => {
    const { chip } = setup();
    const captureSpy = vi.fn();
    chip.setPointerCapture = captureSpy;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(captureSpy).toHaveBeenCalledWith(1);
  });

  it("cancels cleanly on pointercancel without rescheduling", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerCancel(chip, { pointerId: 1 });
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reschedule-day.test.tsx`
Expected: FAIL — `use-drag-to-reschedule-day.ts` doesn't exist yet.

- [ ] **Step 3: Create `use-drag-to-reschedule-day.ts`**

```ts
"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export interface RescheduleDragState {
  id: string;
  title: string;
  targetDate: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToRescheduleDay(options: {
  columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  onReschedule: (id: string, date: string) => void;
}) {
  const { columnRefs, onReschedule } = options;
  const [dragState, setDragState] = useState<RescheduleDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number): string | null => {
      const columns = columnRefs.current;
      for (const date in columns) {
        const el = columns[date];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return date;
        }
      }
      return null;
    },
    [columnRefs],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        gestureRef.current = {
          id,
          title,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;

        if (!gesture.moved) {
          const dx = e.clientX - gesture.startX;
          const dy = e.clientY - gesture.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          gesture.moved = true;
          // Capture only once a real drag starts, not on every pointerdown:
          // capturing unconditionally would redirect a plain click's event
          // target away from nested interactive elements, since browsers
          // retarget the click to whichever element holds pointer capture.
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        const targetDate = resolve(e.clientX, e.clientY);
        setDragState({ id: gesture.id, title: gesture.title, targetDate });
      },
      onPointerUp: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;

        const target = e.currentTarget as HTMLElement;
        if (typeof target.releasePointerCapture === "function") {
          target.releasePointerCapture(e.pointerId);
        }

        if (gesture.moved) {
          suppressClickRef.current = true;
          // Safety net: if the source element unmounts before the browser's
          // post-pointerup click reaches onClickCapture (e.g. a cross-column
          // drop that removes this wrapper from the DOM), the flag would
          // otherwise stay stuck true and swallow the next unrelated click.
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const targetDate = resolve(e.clientX, e.clientY);
          if (targetDate !== null) {
            onReschedule(gesture.id, targetDate);
          }
        }
        setDragState(null);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;
        setDragState(null);
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    }),
    [resolve, onReschedule],
  );

  return { dragState, getDragHandlers };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reschedule-day.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/use-drag-to-reschedule-day.ts frontend/src/features/tasks/components/use-drag-to-reschedule-day.test.tsx
git commit -m "feat: add useDragToRescheduleDay hook for Weekly tab drag-and-drop"
```

---

### Task 2: `rescheduleTaskToDay` store action

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `rescheduleTaskToDay(id: string, date: string): void` on `TasksContextValue` (returned by `useTasks()`) — Task 4 calls this directly as `useDragToRescheduleDay`'s `onReschedule` callback.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/store.test.tsx`, add this block immediately after the existing `detachFromRoutine` tests (after the closing of the `it("detaching today's occurrence, then reloading from the repository, does not respawn a duplicate", ...)` test, i.e., inside the same enclosing `describe` block those tests are in):

```tsx
    it("rescheduleTaskToDay moves a plain task's scope date", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const task = makeTask({ id: "a", scope: { kind: "day", date: today } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", target));

      expect(result.current.tasks[0].scope).toEqual({ kind: "day", date: target });
      await waitFor(() => expect(repo.tasks[0].scope).toEqual({ kind: "day", date: target }));
    });

    it("rescheduleTaskToDay is a no-op when the target date matches the current date", async () => {
      const today = todayKey();
      const task = makeTask({ id: "a", scope: { kind: "day", date: today } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", today));

      expect(result.current.tasks[0]).toBe(task);
      expect(repo.tasks[0]).toBe(task);
    });

    it("rescheduleTaskToDay detaches a repeat instance and excludes its original date on the anchor", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
      });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: today },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("occ", target));

      const moved = result.current.tasks.find((t) => t.id === "occ");
      expect(moved?.scope).toEqual({ kind: "day", date: target });
      expect(moved?.repeatSourceId).toBeUndefined();
      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([today]);
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([today]),
      );
    });

    it("rescheduleTaskToDay appends to the anchor's existing excludedDates rather than replacing them", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
        excludedDates: ["2026-07-09"],
      });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: today },
        repeatSourceId: "anchor",
      });
      const { result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("occ", target));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([
        "2026-07-09",
        today,
      ]);
    });

    it("rescheduleTaskToDay does nothing for a week-scoped task", async () => {
      const task = makeTask({ id: "a", scope: { kind: "week", weekStart: weekStartOf(todayKey()) } });
      const { result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", addDays(todayKey(), 2)));

      expect(result.current.tasks[0]).toBe(task);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — `result.current.rescheduleTaskToDay` is not a function.

- [ ] **Step 3: Add the action**

In `frontend/src/features/tasks/store.tsx`, add this line to the `TasksContextValue` interface, immediately after the existing `detachFromRoutine` line:

```ts
  rescheduleTaskToDay: (id: string, date: string) => void;
```

Then add this method to the `value` object, immediately after the existing `detachFromRoutine(id, weekdays) { ... }` method (i.e., right before `setPriority(id, priority) { ... }`):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add rescheduleTaskToDay store action, detaching repeat instances on move"
```

---

### Task 3: `ScopeTasks` gains an optional `getDragHandlers` prop

**Files:**
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 or 2 directly — the new prop's type is a structural match to Task 1's `getDragHandlers` return shape, declared locally (matching the existing local `GetDragHandlers` type alias pattern already used in `day-agenda.tsx`/`day-timeline.tsx`), not imported from Task 1's file.
- Produces: `ScopeTasks`'s new optional `getDragHandlers?: (id: string, title: string) => {...}` prop — Task 4 passes Task 1's hook output directly into it.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add these two tests inside the existing `describe("ScopeTasks day box (Weekly view props)", ...)` block, after its last existing test (`"without showRepeatLabel, no pill renders even for a repeating task"`):

```tsx
  it("without getDragHandlers, task rows render without a drag wrapper", async () => {
    const day = todayKey();
    const t = makeTask({ title: "plain task", scope: { kind: "day", date: day } });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("plain task")).toBeTruthy());
    expect(screen.getByText("plain task").closest(".touch-none")).toBeNull();
  });

  it("with getDragHandlers, wires the returned handlers onto each task row", async () => {
    const day = todayKey();
    const t = makeTask({ id: "a", title: "draggable task", scope: { kind: "day", date: day } });
    const onPointerDown = vi.fn();
    const getDragHandlers = vi.fn().mockReturnValue({
      onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onClickCapture: vi.fn(),
    });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} getDragHandlers={getDragHandlers} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("draggable task")).toBeTruthy());

    expect(getDragHandlers).toHaveBeenCalledWith("a", "draggable task");
    const wrapper = screen.getByText("draggable task").closest(".touch-none");
    expect(wrapper).not.toBeNull();
    fireEvent.pointerDown(wrapper!, { pointerId: 1 });
    expect(onPointerDown).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — the second test fails because no `.touch-none` wrapper exists yet; `getDragHandlers` is never called.

- [ ] **Step 3: Replace `scope-tasks.tsx`'s implementation**

Replace the full contents of `frontend/src/features/tasks/components/scope-tasks.tsx` with:

```tsx
"use client";

import { cn } from "@/lib/utils";

import { shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
import { compareTasksForDay, dayTasksForWeek, repeatLabelForTask, weeklyRollupTasks } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

type GetDragHandlers = (
  id: string,
  title: string,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
  onSelectTask,
  highlightOverdue = false,
  showRepeatLabel = false,
  getDragHandlers,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
  onSelectTask?: (id: string) => void;
  highlightOverdue?: boolean;
  showRepeatLabel?: boolean;
  getDragHandlers?: GetDragHandlers;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;

  let items: { task: Task; date: string | null }[];
  if (scope.kind === "week") {
    items = weeklyRollupTasks(tasks, scope.weekStart);
  } else if (scope.kind === "day" && highlightOverdue) {
    const scoped = dayTasksForWeek(tasks, scope.date, weekStartOf(scope.date));
    items = [...scoped].sort(compareTasksForDay).map((task) => ({ task, date: null }));
  } else {
    const key = scopeKey(scope);
    const scoped = tasks.filter((t) => scopeKey(t.scope) === key);
    const ordered =
      scope.kind === "day" ? [...scoped].sort(compareTasksForDay) : scoped;
    items = ordered.map((task) => ({ task, date: null }));
  }

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {items.map(({ task: t }) => {
          const subtasks = t.subtasks ?? [];
          const doneCount = subtasks.filter((s) => s.done).length;
          return (
            <li
              key={t.id}
              className={cn(
                "truncate text-xs text-muted-foreground",
                t.done && "line-through opacity-60",
              )}
            >
              {t.time && <span className="tabular-nums">{t.time} · </span>}
              {t.title}
              {subtasks.length > 0 && (
                <span className="tabular-nums"> · {doneCount}/{subtasks.length}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const today = todayKey();
  const dayDate = scope.kind === "day" ? scope.date : null;

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {items.map(({ task: t, date }) => {
          let highlight: "overdue" | "pending" | undefined;
          if (highlightOverdue && dayDate && !t.done) {
            if (dayDate < today) highlight = "overdue";
            else if (dayDate === today) highlight = "pending";
          }
          const taskItem = (
            <TaskItem
              key={t.id}
              task={t}
              dateLabel={date ? shortDateLabel(date, today) : undefined}
              highlight={highlight}
              repeatLabel={showRepeatLabel ? repeatLabelForTask(t, tasks) : undefined}
              onSelect={onSelectTask ? () => onSelectTask(t.id) : undefined}
              {...taskItemHandlers(t.id, actions)}
            />
          );
          if (!getDragHandlers) return taskItem;
          return (
            <div key={t.id} className="touch-none" {...getDragHandlers(t.id, t.title)}>
              <ul>{taskItem}</ul>
            </div>
          );
        })}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (all tests, including the 2 new ones — existing `ScopeTasks` tests must still pass unchanged, since none of them pass `getDragHandlers`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/scope-tasks.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: let ScopeTasks accept optional per-task drag handlers"
```

---

### Task 4: Wire drag-to-reschedule into `WeeklyView`

**Files:**
- Modify: `frontend/src/features/tasks/components/views/weekly-view.tsx`
- Modify: `frontend/src/features/tasks/components/views/weekly-view.test.tsx`

**Interfaces:**
- Consumes: `useDragToRescheduleDay` from Task 1 (`../use-drag-to-reschedule-day`), `rescheduleTaskToDay` from Task 2 (via `useTasks()`), `getDragHandlers` prop from Task 3's `ScopeTasks`.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/views/weekly-view.test.tsx`, add these three tests at the end of the existing `describe("WeeklyView", ...)` block, after the last existing test:

```tsx
  it("drags a task from one day into another, updating its scope and moving it in the UI", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 100,
      width: 100,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-14").textContent).not.toContain("task a");
  });

  it("highlights the day column currently under the pointer while dragging, and clears it on drop", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    expect(targetColumn.className).toContain("ring-brand");

    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(targetColumn.className).not.toContain("ring-brand");
  });

  it("dropping back on the same day column leaves the task where it was", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 100,
      width: 100,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 60, clientY: 60 });

    expect(screen.getByTestId("day-column-2026-07-14").textContent).toContain("task a");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: FAIL — no `data-testid="day-column-..."` elements exist yet, and no `.touch-none` drag wrapper exists.

- [ ] **Step 3: Replace `weekly-view.tsx`'s implementation**

Replace the full contents of `frontend/src/features/tasks/components/views/weekly-view.tsx` with:

```tsx
"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  DAY_LABELS,
  dayOfMonth,
  shortDateLabel,
  todayKey,
  upcomingRepeatDates,
  weekDates,
  weekStartOf,
} from "../../lib/dates";
import { dayTasksForWeek, resolveRepeatWeekdays, weekStats } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";
import { ScopeTasks } from "../scope-tasks";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToRescheduleDay } from "../use-drag-to-reschedule-day";

export interface CalendarViewProps {
  anchor: string;
  onAnchorChange: (dateKey: string) => void;
  onDrillDown?: (view: ViewKind, dateKey: string) => void;
}

const UPCOMING_REPEAT_COUNT = 3;

export function WeeklyView({ anchor, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const weekStart = weekStartOf(anchor);
  const dates = weekDates(weekStart);
  const today = todayKey();
  const { done, total } = weekStats(tasks, weekStart);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));
  const selectedTaskRepeatWeekdays = selectedTask
    ? resolveRepeatWeekdays(selectedTask, tasks)
    : undefined;
  const selectedTaskUpcomingRepeatDates = selectedTaskRepeatWeekdays
    ? upcomingRepeatDates(selectedTaskRepeatWeekdays, today, UPCOMING_REPEAT_COUNT).map((date) =>
        shortDateLabel(date, today),
      )
    : undefined;

  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleDay({
    columnRefs,
    onReschedule: (id, date) => actions.rescheduleTaskToDay(id, date),
  });

  return (
    <div
      data-testid="weekly-view"
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 transition-[padding-right] duration-200 ease-out",
        selectedTask && "pr-[400px]",
      )}
    >
      <div className="shrink-0 rounded-md bg-muted/40 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
          This Week
        </div>
        <div className="flex items-center gap-4">
          <div>
            <span className="text-2xl font-bold tabular-nums">{done}</span>
            <span className="text-sm text-subtle">/{total}</span>
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          upcomingRepeatDates={selectedTaskUpcomingRepeatDates}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1.5">
        {dates.map((date, i) => {
          const dayTasks = dayTasksForWeek(tasks, date, weekStart);
          const dayDone = dayTasks.filter((t) => t.done).length;
          const isDropTarget = dragState?.targetDate === date;
          return (
            <div
              key={date}
              data-testid={`day-column-${date}`}
              ref={(el) => {
                columnRefs.current[date] = el;
              }}
              className={cn(
                "flex min-h-0 flex-col rounded-md bg-card p-1.5 ring-1 ring-ring/40 transition-colors",
                isDropTarget && "bg-brand/5 ring-2 ring-brand",
              )}
            >
              <div className="mb-1 flex shrink-0 items-center justify-between">
                <button
                  type="button"
                  onDoubleClick={() => onDrillDown?.("daily", date)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDrillDown?.("daily", date);
                    }
                  }}
                  aria-label={`Go to ${date}`}
                  className={cn(
                    "text-left text-xs font-semibold",
                    date === today ? "text-brand" : "text-subtle",
                  )}
                >
                  {DAY_LABELS[i]} {dayOfMonth(date)}
                </button>
                <span className="text-[10px] tabular-nums text-subtle">
                  {dayDone}/{dayTasks.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ScopeTasks
                  scope={{ kind: "day", date }}
                  quickAdd
                  onSelectTask={handleSelectTask}
                  highlightOverdue
                  showRepeatLabel
                  getDragHandlers={getDragHandlers}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (this task changes no exported interfaces other tests depend on beyond what Tasks 1-3 already established).

- [ ] **Step 6: Run type-check and lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src --quiet`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/views/weekly-view.tsx frontend/src/features/tasks/components/views/weekly-view.test.tsx
git commit -m "feat: wire drag-to-reschedule into the Weekly tab"
```
