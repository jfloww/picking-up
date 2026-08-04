# Weekly Drag Handle (Reorder + Reschedule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Weekly's whole-card drag-to-reschedule with a dedicated handle that drives two outcomes depending on drop target: same-day untimed reorder, or cross-day reschedule (any task).

**Architecture:** A new combined pointer-gesture hook (`useDragToRescheduleOrReorder`) resolves a drag against day-column bounding rects (reschedule, if a different day) and per-task item rects within the dragged task's own day (reorder, if untimed and same day). `compareTasksForDay` gains an `order` tie-break so reordering is visible; `rescheduleTaskToDay` gains an append-order step for untimed cross-day moves. `useDragToRescheduleDay` is deleted once nothing references it.

**Tech Stack:** Next.js/React 19, existing `GripVertical` icon (already used by Daily's handle) — no new dependencies.

## Global Constraints

- **One handle, two outcomes, resolved at drop time**: same day → reorder; different day → reschedule; outside every column → cancel, nothing dispatched.
- **Same-day reorder is untimed-only.** A timed task dropped within its own day is a no-op, no insertion indicator shown. Insertion targets for an untimed task's same-day reorder are only that day's *other untimed* tasks (done or not — Weekly has no separate "done" section to exclude from).
- **The handle shows on every day-scoped card** — timed, untimed, done, or not — since it still needs to serve cross-day rescheduling for all of them.
- **A cross-day move of an untimed task appends to the destination's untimed list** (`max(existing) + 1`, same pattern as `addTask`). A cross-day move of a timed task needs no such handling — `time` alone determines its position.
- **`order` is an app-wide tie-break concept**, not Weekly-local: `compareTasksForDay`'s existing no-op tie for two untimed tasks becomes an `order` comparison. This also affects Monthly's day-cell preview and the week-level task rollup, both already sorting mixed timed/untimed lists with an arbitrary tie for untimed pairs — a deliberate, accepted side effect, not a regression.
- **`useDragToRescheduleDay` and its test file are deleted** once the new hook replaces its one usage (`weekly-view.tsx`) and its test scenarios all have an equivalent in the new hook's tests.
- **`useDragToSchedule` (Daily's timeline drag) and `useDragToReorder` (Daily's All-Day-To-Do drag) are untouched.**
- Card layout (`TaskItem`'s new `size="week"`): handle, checkbox, then — when the task has a repeat cadence, a time, or subtasks — that metadata on line 1 (cadence label right after the checkbox, time + subtask count grouped at the right edge) and the title on line 2; when there's no metadata at all, one line: handle, checkbox, title.

---

### Task 1: `compareTasksForDay` order tie-break

**Files:**
- Modify: `frontend/src/features/tasks/lib/times.ts`
- Modify: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Produces: `compareTasksForDay(a: Task, b: Task): number` — unchanged signature, now returns `a.order - b.order` instead of `0` when both tasks are untimed. Task 5's Weekly integration tests rely on this to make reordering visible.

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/lib/times.test.ts`, replace the existing test:

```typescript
  it("returns 0 for two untimed tasks (stable sort keeps insertion order)", () => {
    expect(compareTasksForDay(task({}), task({}))).toBe(0);
  });
```

with:

```typescript
  it("returns 0 for two untimed tasks with equal order", () => {
    expect(compareTasksForDay(task({ order: 5 }), task({ order: 5 }))).toBe(0);
  });

  it("breaks ties between two untimed tasks by order", () => {
    const first = task({ order: 1 });
    const second = task({ order: 2 });
    expect([second, first].sort(compareTasksForDay)).toEqual([first, second]);
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts -t "breaks ties between two untimed tasks by order"`
Expected: FAIL — currently returns `0` regardless of `order`.

- [ ] **Step 3: Update the comparator**

In `frontend/src/features/tasks/lib/times.ts`, change:

```typescript
export function compareTasksForDay(a: Task, b: Task): number {
  if (a.time && b.time) {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  }
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}
```

to:

```typescript
export function compareTasksForDay(a: Task, b: Task): number {
  if (a.time && b.time) {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  }
  if (a.time) return -1;
  if (b.time) return 1;
  return a.order - b.order;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/times.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: break compareTasksForDay's untimed tie by order"
```

---

### Task 2: `rescheduleTaskToDay` appends order for untimed cross-day moves

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: nothing new (uses `state.tasks`, already in scope).
- Produces: `rescheduleTaskToDay(id: string, date: string): void` — unchanged signature, unchanged behavior for timed tasks; for untimed tasks, the dispatched update now also carries a recomputed `order`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/store.test.tsx` (as siblings of the other `rescheduleTaskToDay` tests):

```typescript
  it("rescheduleTaskToDay appends order for an untimed task moved to a new day", async () => {
    const existing = makeTask({ id: "e", order: 3, scope: { kind: "day", date: "2026-07-20" } });
    const moved = makeTask({ id: "a", order: 99, scope: { kind: "day", date: "2026-07-14" } });
    const { repo, result } = setup(fakeRepository([existing, moved]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.rescheduleTaskToDay("a", "2026-07-20"));

    expect(result.current.tasks.find((t) => t.id === "a")?.order).toBe(4);
    await waitFor(() => expect(repo.tasks.find((t) => t.id === "a")?.order).toBe(4));
  });

  it("rescheduleTaskToDay leaves a timed task's order untouched when moved to a new day", async () => {
    const moved = makeTask({
      id: "a",
      order: 7,
      time: "09:00",
      scope: { kind: "day", date: "2026-07-14" },
    });
    const { result } = setup(fakeRepository([moved]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.rescheduleTaskToDay("a", "2026-07-20"));

    expect(result.current.tasks.find((t) => t.id === "a")?.order).toBe(7);
  });

  it("rescheduleTaskToDay starts an untimed task at order 1 when the destination day has no untimed tasks yet", async () => {
    const moved = makeTask({ id: "a", order: 99, scope: { kind: "day", date: "2026-07-14" } });
    const { result } = setup(fakeRepository([moved]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.rescheduleTaskToDay("a", "2026-07-20"));

    expect(result.current.tasks.find((t) => t.id === "a")?.order).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx -t "rescheduleTaskToDay appends order"`
Expected: FAIL — `order` stays `99` (unchanged), not `4`.

- [ ] **Step 3: Update `rescheduleTaskToDay`**

In `frontend/src/features/tasks/store.tsx`, replace:

```typescript
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

        const task: Task = { ...current, scope: { kind: "day", date }, rolledFrom: undefined };
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

with:

```typescript
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
        // untimed tasks instead, same computation addTask uses. A timed
        // task's position is always driven by `time`, not `order`, so its
        // existing value is left as-is.
        const order = current.time
          ? current.order
          : Math.max(
              0,
              ...state.tasks
                .filter(
                  (t) =>
                    t.scope.kind === "day" &&
                    t.scope.date === date &&
                    !t.time &&
                    !t.done,
                )
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS — all tests in the file, including the three new ones and every pre-existing `rescheduleTaskToDay` test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: append order for untimed tasks rescheduled to a new day"
```

---

### Task 3: `TaskItem`'s new `size="week"` layout

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Create: `frontend/src/features/tasks/components/task-item.test.tsx`

**Interfaces:**
- Produces: `TaskItem`'s `size` prop accepts `"week"` in addition to the existing `"default" | "large" | "timeline"`. No new props — the handle itself is rendered by the caller (`scope-tasks.tsx`, Task 5), not by `TaskItem`, matching how Daily's `day-agenda.tsx` renders its own handle around a plain `TaskItem` rather than teaching `TaskItem` about drag handles.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-item.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskItem } from "./task-item";
import { makeTask } from "../test-utils";

const noopHandlers = {
  onToggle: () => {},
  onMemoChange: () => {},
  onTimeChange: () => {},
  onRepeatWeekdaysChange: () => {},
  onDetachFromRoutine: () => {},
  onPriorityChange: () => {},
  onDurationChange: () => {},
  onBackgroundChange: () => {},
  onDueDateChange: () => {},
  onDelete: () => {},
  onAddSubtask: () => {},
  onToggleSubtask: () => {},
  onRemoveSubtask: () => {},
  onEditSubtaskTitle: () => {},
};

describe('TaskItem size="week"', () => {
  it("collapses to a single line when the task has no time, subtasks, or repeat", () => {
    const task = makeTask({ title: "buy milk" });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("buy milk")).toBeTruthy();
    expect(screen.queryByLabelText(/Subtasks:/)).toBeNull();
  });

  it("shows a metadata line with time and subtask count when present", () => {
    const task = makeTask({
      title: "team sync",
      time: "09:00",
      subtasks: [{ id: "s1", title: "agenda", done: false }],
    });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("team sync")).toBeTruthy();
    expect(screen.getByText("9:00 AM")).toBeTruthy();
    expect(screen.getByLabelText("Subtasks: 0/1")).toBeTruthy();
  });

  it("shows the repeat cadence label next to the checkbox when provided", () => {
    const task = makeTask({ title: "gym" });
    render(<TaskItem task={task} size="week" repeatLabel="Mo/We/Fr" {...noopHandlers} />);
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
  });

  it("calls onSelect when the title is clicked", () => {
    const task = makeTask({ title: "call dentist" });
    const onSelect = vi.fn();
    render(<TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />);
    fireEvent.click(screen.getByText("call dentist"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("strikes through the title and dims the card for a done task", () => {
    const task = makeTask({ title: "done thing", done: true });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("done thing").className).toContain("line-through");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-item.test.tsx`
Expected: FAIL — `size="week"` currently falls through to the default branch, which doesn't match these assertions (e.g. no dedicated metadata-collapse behavior).

- [ ] **Step 3: Add the `size="week"` branch**

In `frontend/src/features/tasks/components/task-item.tsx`, change the `size` prop's type in both places it's declared:

```typescript
  size = "default",
```

(unchanged) and:

```typescript
  size?: "default" | "large" | "timeline";
```

to:

```typescript
  size?: "default" | "large" | "timeline" | "week";
```

Add `const week = size === "week";` directly after the existing `const timeline = size === "timeline";` line, and extend `timeBadge`'s className to size text the same as `timeline` for the week variant — change:

```typescript
  const timeBadge = task.time && (
    <span
      className={cn(
        "shrink-0 tabular-nums text-subtle",
        timeline ? "text-[11px]" : "text-xs",
      )}
    >
      {timeline ? formatTaskTimeRange(task.time, task.durationMinutes) : formatTaskTime(task.time)}
    </span>
  );
```

to:

```typescript
  const timeBadge = task.time && (
    <span
      className={cn(
        "shrink-0 tabular-nums text-subtle",
        timeline || week ? "text-[11px]" : "text-xs",
      )}
    >
      {timeline ? formatTaskTimeRange(task.time, task.durationMinutes) : formatTaskTime(task.time)}
    </span>
  );
```

Add a new branch directly after the existing `if (timeline) { ... }` block (before the shared `large`/`default` `return (<li>...`):

```tsx
  if (week) {
    const hasMeta = !!task.time || subtasks.length > 0 || !!repeatLabel;
    return (
      <li>
        <div className={cn("rounded-lg bg-muted px-2 py-1.5", task.done && "opacity-55")}>
          {hasMeta && (
            <div className="flex items-center gap-1.5">
              <span onClick={(e) => e.stopPropagation()} className="contents">
                <Checkbox
                  checked={task.done}
                  onCheckedChange={onToggle}
                  aria-label={`Toggle ${task.title}`}
                  className={cn("size-[13px] border-subtle", DONE_CHECKBOX_CLASS)}
                />
              </span>
              {repeatLabel && (
                <span className="shrink-0 truncate rounded bg-card px-1 text-[9.5px] font-medium text-muted-foreground">
                  {repeatLabel}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {timeBadge}
                {subtasks.length > 0 && (
                  <span
                    aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
                    className="shrink-0 rounded bg-card px-1 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {doneCount}/{subtasks.length}
                  </span>
                )}
              </span>
            </div>
          )}
          {!hasMeta && (
            <span onClick={(e) => e.stopPropagation()} className="contents">
              <Checkbox
                checked={task.done}
                onCheckedChange={onToggle}
                aria-label={`Toggle ${task.title}`}
                className={cn("mr-1.5 size-[13px] border-subtle", DONE_CHECKBOX_CLASS)}
              />
            </span>
          )}
          <button
            type="button"
            onClick={selectOrToggle}
            className={cn(
              "text-left text-[12.5px] leading-[1.35]",
              hasMeta ? "mt-1 block w-full" : "inline",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
        </div>
      </li>
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-item.test.tsx`
Expected: PASS — all five tests.

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no regressions in any other `TaskItem` size, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/task-item.test.tsx
git commit -m 'feat: add TaskItem size="week", a two-line-when-needed compact card'
```

---

### Task 4: `useDragToRescheduleOrReorder` hook

**Files:**
- Create: `frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.ts`
- Create: `frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.test.tsx`

**Interfaces:**
- Produces: `useDragToRescheduleOrReorder(options: { columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>; itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>; orderedIdsByDate: Record<string, string[]>; onReorder: (id: string, insertBeforeId: string | null, sourceDate: string) => void; onReschedule: (id: string, date: string) => void }): { dragState: RescheduleOrReorderDragState | null; getDragHandlers: (id: string, title: string, sourceDate: string, timed: boolean) => {...} }`.
  `onReorder`'s third argument is the dragged task's own day — the hook
  already knows it from the gesture that started the drag, so the caller
  never has to search for it.
  `RescheduleOrReorderDragState` is `{ id: string; title: string; pointerX: number; pointerY: number; resolution: DragResolution }`, where `DragResolution` is one of: `{ kind: "reorder"; insertBeforeId: string | null }`, `{ kind: "reorder-noop" }`, `{ kind: "reschedule"; date: string }`, `{ kind: "outside" }`.
  Task 5 imports and wires this directly, and deletes `use-drag-to-reschedule-day.ts` once this replaces its usage.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToRescheduleOrReorder } from "./use-drag-to-reschedule-or-reorder";

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

function Harness({
  onReorder,
  onReschedule,
}: {
  onReorder: (id: string, insertBeforeId: string | null, sourceDate: string) => void;
  onReschedule: (id: string, date: string) => void;
}) {
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleOrReorder({
    columnRefs,
    itemRefs,
    orderedIdsByDate: { "2026-07-13": ["a", "b"], "2026-07-14": ["c"] },
    onReorder,
    onReschedule,
  });

  return (
    <div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-13"] = el;
        }}
        data-testid="col-mon"
      >
        <div
          ref={(el) => {
            itemRefs.current["a"] = el;
          }}
          data-testid="item-a"
        >
          <button type="button" data-testid="handle-a" {...getDragHandlers("a", "Task A", "2026-07-13", false)} onClick={() => onReorder("clicked", null, "2026-07-13")}>
            Handle A
          </button>
        </div>
        <div
          ref={(el) => {
            itemRefs.current["b"] = el;
          }}
          data-testid="item-b"
        />
        <button type="button" data-testid="handle-timed" {...getDragHandlers("timed", "Timed Task", "2026-07-13", true)}>
          Handle Timed
        </button>
      </div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-14"] = el;
        }}
        data-testid="col-tue"
      />
      <div data-testid="resolution">
        {dragState ? JSON.stringify(dragState.resolution) : "not-dragging"}
      </div>
    </div>
  );
}

function setup(onReorder = vi.fn(), onReschedule = vi.fn()) {
  render(<Harness onReorder={onReorder} onReschedule={onReschedule} />);
  mockRect(screen.getByTestId("col-mon"), { top: 0, bottom: 200, left: 0, right: 100 });
  mockRect(screen.getByTestId("col-tue"), { top: 0, bottom: 200, left: 200, right: 300 });
  mockRect(screen.getByTestId("item-a"), { top: 0, bottom: 50, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-b"), { top: 50, bottom: 100, left: 0, right: 100 });
  return {
    onReorder,
    onReschedule,
    handleA: screen.getByTestId("handle-a"),
    handleTimed: screen.getByTestId("handle-timed"),
  };
}

describe("useDragToRescheduleOrReorder", () => {
  it("does nothing on a plain click (no movement past the threshold)", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("resolves same-day untimed drop to a reorder, targeting the item whose upper half the pointer is over", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 }); // upper half of item-b (50-100)
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reorder", insertBeforeId: "b" }),
    );
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).toHaveBeenCalledWith("a", "b", "2026-07-13");
  });

  it("resolves same-day untimed drop past every item to insertBeforeId null", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 150 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 150 });
    expect(onReorder).toHaveBeenCalledWith("a", null, "2026-07-13");
  });

  it("is a no-op with no indicator when a timed task is dropped within its own day", () => {
    const { onReorder, onReschedule, handleTimed } = setup();
    fireEvent.pointerDown(handleTimed, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleTimed, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reorder-noop" }),
    );
    fireEvent.pointerUp(handleTimed, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("resolves a drop on a different day's column to a reschedule, regardless of timed/untimed", () => {
    const { onReschedule, handleTimed } = setup();
    fireEvent.pointerDown(handleTimed, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleTimed, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reschedule", date: "2026-07-14" }),
    );
    fireEvent.pointerUp(handleTimed, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(onReschedule).toHaveBeenCalledWith("timed", "2026-07-14");
  });

  it("is a no-op when dropped outside every column", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(screen.getByTestId("resolution").textContent).toBe(JSON.stringify({ kind: "outside" }));
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.click(handleA);
    expect(onReorder).toHaveBeenCalledTimes(1); // only the reorder call
    expect(onReorder).toHaveBeenCalledWith("a", "b", "2026-07-13");
  });

  it("cancels cleanly on pointercancel without dispatching either outcome", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerCancel(handleA, { pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("resolution").textContent).toBe("not-dragging");
  });

  it("stops the pointerdown event from propagating to the card", () => {
    const { handleA } = setup();
    const parent = screen.getByTestId("item-a");
    const parentPointerDown = vi.fn();
    parent.addEventListener("pointerdown", parentPointerDown);
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(parentPointerDown).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reschedule-or-reorder.test.tsx`
Expected: FAIL — cannot find module `./use-drag-to-reschedule-or-reorder` (doesn't exist yet).

- [ ] **Step 3: Write the hook**

Create `frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.ts`:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export type DragResolution =
  | { kind: "reorder"; insertBeforeId: string | null }
  | { kind: "reorder-noop" }
  | { kind: "reschedule"; date: string }
  | { kind: "outside" };

export interface RescheduleOrReorderDragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  resolution: DragResolution;
}

interface DragGesture {
  id: string;
  title: string;
  sourceDate: string;
  timed: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToRescheduleOrReorder(options: {
  columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  orderedIdsByDate: Record<string, string[]>;
  onReorder: (id: string, insertBeforeId: string | null, sourceDate: string) => void;
  onReschedule: (id: string, date: string) => void;
}) {
  const { columnRefs, itemRefs, orderedIdsByDate, onReorder, onReschedule } = options;
  const [dragState, setDragState] = useState<RescheduleOrReorderDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number, sourceDate: string, timed: boolean): DragResolution => {
      const columns = columnRefs.current;
      for (const date in columns) {
        const el = columns[date];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
          continue;
        }
        if (date !== sourceDate) return { kind: "reschedule", date };
        if (timed) return { kind: "reorder-noop" };
        const refs = itemRefs.current;
        for (const id of orderedIdsByDate[date] ?? []) {
          const itemEl = refs[id];
          if (!itemEl) continue;
          const itemRect = itemEl.getBoundingClientRect();
          if (clientY < (itemRect.top + itemRect.bottom) / 2) {
            return { kind: "reorder", insertBeforeId: id };
          }
        }
        return { kind: "reorder", insertBeforeId: null };
      }
      return { kind: "outside" };
    },
    [columnRefs, itemRefs, orderedIdsByDate],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string, sourceDate: string, timed: boolean) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // This hook attaches to a small handle nested inside a card; without
        // stopping propagation, pressing the handle would also bubble to
        // whatever other pointer handlers the card itself carries.
        e.stopPropagation();
        gestureRef.current = {
          id,
          title,
          sourceDate,
          timed,
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
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          resolution: resolve(e.clientX, e.clientY, gesture.sourceDate, gesture.timed),
        });
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
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const resolution = resolve(e.clientX, e.clientY, gesture.sourceDate, gesture.timed);
          if (resolution.kind === "reorder") {
            onReorder(gesture.id, resolution.insertBeforeId, gesture.sourceDate);
          } else if (resolution.kind === "reschedule") {
            onReschedule(gesture.id, resolution.date);
          }
          // "reorder-noop" and "outside" dispatch nothing.
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
    [resolve, onReorder, onReschedule],
  );

  return { dragState, getDragHandlers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reschedule-or-reorder.test.tsx`
Expected: PASS — all nine tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.ts frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.test.tsx
git commit -m "feat: add useDragToRescheduleOrReorder, combining same-day reorder and cross-day reschedule in one gesture"
```

---

### Task 5: Wire the handle into Weekly, delete the old hook

**Files:**
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Modify: `frontend/src/features/tasks/components/views/weekly-view.tsx`
- Modify: `frontend/src/features/tasks/components/views/weekly-view.test.tsx`
- Delete: `frontend/src/features/tasks/components/use-drag-to-reschedule-day.ts`
- Delete: `frontend/src/features/tasks/components/use-drag-to-reschedule-day.test.tsx`

**Interfaces:**
- Consumes: `useDragToRescheduleOrReorder` (Task 4), `compareTasksForDay` (Task 1), `rescheduleTaskToDay`/`setOrder` (Task 2 and pre-existing), `TaskItem`'s `size="week"` (Task 3).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/views/weekly-view.test.tsx`, replace every existing drag test — `"drags a task from one day into another..."`, `"highlights the day column currently under the pointer..."`, `"dropping back on the same day column leaves the task where it was"`, `"drags a future-dated, never-rolled-over task..."`, and `"drags an explicitly rolled-over task..."` (five tests total, all currently querying `screen.getByText("task a").closest(".touch-none")!` as the drag source) — with the following, which replace the whole-card drag with a drag on the new handle (`screen.getByLabelText("Reorder task a")`), and add coverage for same-day reordering:

```typescript
  it("reschedules a task dragged from one day into another, updating its scope and moving it in the UI", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-14").textContent).not.toContain("task a");
  });

  it("highlights the day column currently under the pointer while dragging cross-day, and clears it on drop", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    expect(targetColumn.className).toContain("ring-brand");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(targetColumn.className).not.toContain("ring-brand");
  });

  it("dragging an untimed task to a new position within its own day reorders it and calls setOrder, not rescheduleTaskToDay", async () => {
    const first = makeTask({ id: "a", title: "first", order: 1, scope: { kind: "day", date: "2026-07-14" } });
    const second = makeTask({ id: "b", title: "second", order: 2, scope: { kind: "day", date: "2026-07-14" } });
    const repo = fakeRepository([first, second]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "first" })).toBeTruthy());

    const column = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    const cardFirst = screen.getByText("first").closest("li")!;
    const cardSecond = screen.getByText("second").closest("li")!;
    vi.spyOn(cardFirst, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardSecond, "getBoundingClientRect").mockReturnValue({
      top: 40, bottom: 80, left: 0, right: 100, width: 100, height: 40, x: 0, y: 40, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder first");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 70 }); // past second's midpoint
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 70 });

    await waitFor(() => expect(repo.tasks.find((t) => t.id === "a")?.order).toBeGreaterThan(2));
    expect(repo.tasks.find((t) => t.id === "a")?.scope).toEqual({ kind: "day", date: "2026-07-14" });
  });

  it("dragging a timed task within its own day is a no-op", async () => {
    const timed = makeTask({
      id: "a",
      title: "timed task",
      time: "09:00",
      order: 1,
      scope: { kind: "day", date: "2026-07-14" },
    });
    const repo = fakeRepository([timed]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "timed task" })).toBeTruthy());

    const column = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder timed task");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 20 });

    expect(repo.tasks.find((t) => t.id === "a")?.order).toBe(1);
  });

  it("dropping back on the same day column leaves the task where it was", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 60, clientY: 60 });

    expect(screen.getByTestId("day-column-2026-07-14").textContent).toContain("task a");
  });

  it("reschedules a future-dated, never-rolled-over task dragged into another day", async () => {
    // Unlike the drag tests above (whose "2026-07-14" fixture is before the
    // frozen "today" of 2026-07-16 and therefore gets converted to a
    // week-scoped, rolled-over task by rollover logic on mount), this task's
    // date is on/after "today", so it stays a plain day-scoped task and this
    // test exercises the plain scope.kind === "day" drag path.
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-17" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-17");
    const targetColumn = screen.getByTestId("day-column-2026-07-18");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-18").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-17").textContent).not.toContain("task a");
  });

  it("reschedules an explicitly rolled-over task (week scope with a day rolledFrom), moving it to the dropped column", async () => {
    // Constructed directly with scope.kind "week" + rolledFrom, rather than
    // relying on the rollover mechanism to produce this shape implicitly.
    // This deliberately targets the rolled-over branch of rescheduleTaskToDay.
    const a = makeTask({
      id: "a",
      title: "task a",
      scope: { kind: "week", weekStart: "2026-07-12" },
      rolledFrom: { kind: "day", date: "2026-07-14" },
    });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: FAIL — `getByLabelText("Reorder task a")` finds nothing yet (no handle wired), and `WeeklyView` still uses the old whole-card `useDragToRescheduleDay`.

- [ ] **Step 3: Wire `scope-tasks.tsx`**

In `frontend/src/features/tasks/components/scope-tasks.tsx`, change the `GetDragHandlers` type from:

```typescript
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
```

to:

```typescript
type GetDragHandlers = (
  id: string,
  title: string,
  sourceDate: string,
  timed: boolean,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};
```

Add `import { GripVertical } from "lucide-react";` at the top.

Replace the rendering loop's return (the part after `const taskItem = (...)`) — currently:

```tsx
          if (!getDragHandlers || t.done) return taskItem;
          return (
            <li key={t.id} className="touch-none" {...getDragHandlers(t.id, t.title)}>
              <ul>{taskItem}</ul>
            </li>
          );
```

with:

```tsx
          if (!getDragHandlers) return taskItem;
          return (
            <li key={t.id} className="flex items-start gap-1.5">
              <button
                type="button"
                aria-label={`Reorder ${t.title}`}
                className="mt-1 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                {...getDragHandlers(t.id, t.title, dayDate!, !!t.time)}
              >
                <GripVertical className="size-3.5" />
              </button>
              <div className="min-w-0 flex-1">{taskItem}</div>
            </li>
          );
```

Note this also drops the previous `|| t.done` exclusion — per the spec, the handle now shows for done tasks too (matching the existing reschedule behavior's "done or not" rule), and `TaskItem`'s own strikethrough/dimming already communicates done state.

Also change the `<TaskItem ...>` call inside `taskItem` to pass `size={getDragHandlers ? "week" : undefined}` — add this prop directly after `key={t.id}`:

```tsx
            <TaskItem
              key={t.id}
              size={getDragHandlers ? "week" : undefined}
              task={t}
```

- [ ] **Step 4: Wire `weekly-view.tsx`**

Replace the whole file's drag-related parts. Change the import:

```typescript
import { useDragToRescheduleDay } from "../use-drag-to-reschedule-day";
```

to:

```typescript
import { useDragToRescheduleOrReorder } from "../use-drag-to-reschedule-or-reorder";
```

Replace:

```typescript
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleDay({
    columnRefs,
    onReschedule: (id, date) => actions.rescheduleTaskToDay(id, date),
  });
```

with:

```typescript
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const orderedIdsByDate: Record<string, string[]> = {};
  for (const date of dates) {
    orderedIdsByDate[date] = [...dayTasksForWeek(tasks, date, weekStart)]
      .filter((t) => !t.time)
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id);
  }
  const { dragState, getDragHandlers } = useDragToRescheduleOrReorder({
    columnRefs,
    itemRefs,
    orderedIdsByDate,
    onReorder: (id, insertBeforeId, sourceDate) => {
      const ids = orderedIdsByDate[sourceDate] ?? [];
      const remaining = ids.filter((taskId) => taskId !== id);
      const targetIndex =
        insertBeforeId === null ? remaining.length : remaining.indexOf(insertBeforeId);
      if (targetIndex === -1) return;
      const byId = (taskId: string) => tasks.find((t) => t.id === taskId);
      const before = targetIndex > 0 ? byId(remaining[targetIndex - 1])?.order : undefined;
      const after =
        targetIndex < remaining.length ? byId(remaining[targetIndex])?.order : undefined;
      const dragged = byId(id);
      if (!dragged) return;
      const newOrder = computeOrderBetween(before, after);
      if (newOrder === dragged.order) return;
      actions.setOrder(id, newOrder);
    },
    onReschedule: (id, date) => actions.rescheduleTaskToDay(id, date),
  });
```

Add the import for `computeOrderBetween` at the top, alongside the other `../../lib/*` imports:

```typescript
import { computeOrderBetween } from "../../lib/reorder";
```

Update the day-column highlight check — change:

```typescript
          const isDropTarget = dragState?.targetDate === date;
```

to:

```typescript
          const isDropTarget =
            dragState?.resolution.kind === "reschedule" && dragState.resolution.date === date;
```

Add `itemRefs` to the per-day `<div ref={...}>` — the day column's own ref callback (`ref={(el) => { columnRefs.current[date] = el; }}`) stays as-is; `itemRefs` is populated per-task inside `ScopeTasks`, which needs its own way to register into the shared `itemRefs` map. Pass `itemRefs` down as a new prop to `ScopeTasks`:

```tsx
                <ScopeTasks
                  scope={{ kind: "day", date }}
                  quickAdd
                  onSelectTask={handleSelectTask}
                  highlightOverdue
                  showRepeatLabel
                  getDragHandlers={getDragHandlers}
                  itemRefs={itemRefs}
                />
```

Back in `scope-tasks.tsx`, accept this new prop and wire it onto the handle's wrapping `<li>`:

```typescript
export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
  onSelectTask,
  highlightOverdue = false,
  showRepeatLabel = false,
  getDragHandlers,
  itemRefs,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
  onSelectTask?: (id: string) => void;
  highlightOverdue?: boolean;
  showRepeatLabel?: boolean;
  getDragHandlers?: GetDragHandlers;
  itemRefs?: React.RefObject<Record<string, HTMLDivElement | null>>;
}) {
```

and in the handle branch, add the ref to the wrapping `<li>`:

```tsx
            <li
              key={t.id}
              ref={
                itemRefs
                  ? (el) => {
                      itemRefs.current[t.id] = el;
                    }
                  : undefined
              }
              className="flex items-start gap-1.5"
            >
```

- [ ] **Step 5: Delete the superseded hook**

```bash
git rm frontend/src/features/tasks/components/use-drag-to-reschedule-day.ts frontend/src/features/tasks/components/use-drag-to-reschedule-day.test.tsx
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: PASS — all tests in the file, including the rewritten and new ones.

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no regressions anywhere else `ScopeTasks` is used (`day-agenda-drawer.tsx` doesn't pass `getDragHandlers`, so it's unaffected by the signature change), no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/scope-tasks.tsx frontend/src/features/tasks/components/views/weekly-view.tsx frontend/src/features/tasks/components/views/weekly-view.test.tsx
git commit -m "feat: wire the reorder-or-reschedule handle into Weekly, delete the superseded whole-card drag hook"
```
