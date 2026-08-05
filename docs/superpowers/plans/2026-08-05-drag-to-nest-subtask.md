# Drag a Task onto Another Task to Nest It as a Subtask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Daily's agenda list, dragging a task card and dropping it onto another task card converts the dragged task into a subtask of the target — immediately for simple tasks, after an explicit confirmation for tasks that would lose data, and blocked entirely (with an explanation) for tasks that already have subtasks or are part of a repeat series.

**Architecture:** `useDragToSchedule`'s drop resolution becomes a tagged union with two new outcomes (`nest`, `nest-blocked`) alongside the existing `clear-time`/`schedule`/`outside`, checked first since a card is a more specific target than the zone it sits in. `DayAgenda` grows a card-ref map (mirroring `use-drag-to-reorder.ts`'s own `itemRefs`) so the hook can hit-test every agenda card, not just the reorderable ones. `DailyView` owns the resulting orchestration: a new confirmation overlay component for lossy conversions, a reused `Alert`-banner pattern for blocked drops, and one new store action, `convertTaskToSubtask`, that performs the actual data mutation (compose of the existing `addSubtask` + `removeTask` shapes — no new backend work, since `Task.subtasks` is already a plain JSON column).

**Tech Stack:** Next.js/React 19 (existing), Vitest + `@testing-library/react` (existing) — no new dependencies.

## Global Constraints

- **Daily only.** No changes to Weekly, Monthly, or Bucket List.
- **Drop targets are agenda-list cards only** (All Day To-Do, Next Up, Done Today) — not the timeline rail. Rail cards remain valid drag *sources* (their `getDragHandlers` call site still needs the eligibility check computed and passed in), just not drop targets.
- **A `Subtask` can only hold `title` and `done`** (`types.ts:14-18`) — no memo, time, duration, priority, due date, background, or its own subtasks.
- **Blocking is a property of the dragged task, not the target.** A target already having subtasks is normal (that's the point). Blocking applies when the *source* task already has subtasks, or is part of a repeat series (`repeatWeekdays` set, or `repeatSourceId` set) — repeat tasks are blocked because removing one has side effects on the rest of the series, not just data loss.
- **Simple tasks (no memo/time/duration/priority/due date/background) convert immediately, no confirmation.** Anything else requires an explicit confirm, listing exactly what will be lost.
- **No backend changes.** `backend/apps/tasks/models.py`'s `subtasks` field and `TaskSerializer` are untouched — this plan is 100% frontend.

---

### Task 1: Pure domain logic — `lib/nesting.ts` + the `convertTaskToSubtask` store action

**Files:**
- Create: `frontend/src/features/tasks/lib/nesting.ts`
- Create: `frontend/src/features/tasks/lib/nesting.test.ts`
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Produces: `NestBlockReason = "has-subtasks" | "repeating"`; `nestBlockReasonFor(task: Task): NestBlockReason | undefined`; `nestBlockMessage(reason: NestBlockReason): string`; `lostFieldsFor(task: Task): string[]`. Task 2 (the hook) imports `NestBlockReason`. Task 4 (UI wiring) imports all four.
- Produces: `convertTaskToSubtask(id: string, targetId: string): void` on the `TasksContextValue` interface and the actions object, alongside `addSubtask`/`removeTask`.

- [ ] **Step 1: Write the failing tests for `lib/nesting.ts`**

Create `frontend/src/features/tasks/lib/nesting.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { lostFieldsFor, nestBlockMessage, nestBlockReasonFor } from "./nesting";

describe("nestBlockReasonFor", () => {
  it("returns undefined for a plain task", () => {
    expect(nestBlockReasonFor(makeTask({}))).toBeUndefined();
  });

  it("returns has-subtasks for a task with its own subtasks", () => {
    expect(
      nestBlockReasonFor(makeTask({ subtasks: [{ id: "s1", title: "x", done: false }] })),
    ).toBe("has-subtasks");
  });

  it("returns repeating for a recurring anchor", () => {
    expect(nestBlockReasonFor(makeTask({ repeatWeekdays: [1, 3] }))).toBe("repeating");
  });

  it("returns repeating for a generated occurrence", () => {
    expect(nestBlockReasonFor(makeTask({ repeatSourceId: "anchor-1" }))).toBe("repeating");
  });

  it("has-subtasks takes priority when both apply", () => {
    expect(
      nestBlockReasonFor(
        makeTask({ subtasks: [{ id: "s1", title: "x", done: false }], repeatWeekdays: [1] }),
      ),
    ).toBe("has-subtasks");
  });
});

describe("nestBlockMessage", () => {
  it("has a distinct message per reason", () => {
    expect(nestBlockMessage("has-subtasks")).toMatch(/subtasks/);
    expect(nestBlockMessage("repeating")).toMatch(/series/i);
  });
});

describe("lostFieldsFor", () => {
  it("returns an empty array for a plain task", () => {
    expect(lostFieldsFor(makeTask({}))).toEqual([]);
  });

  it("lists every field that would be lost, in a stable order", () => {
    expect(
      lostFieldsFor(
        makeTask({
          memo: "call the plumber",
          time: "09:00",
          durationMinutes: 30,
          priority: true,
          dueDate: "2026-08-10",
          background: true,
        }),
      ),
    ).toEqual(["note", "time", "duration", "priority", "due date", "background"]);
  });

  it("omits fields that aren't set", () => {
    expect(lostFieldsFor(makeTask({ priority: true }))).toEqual(["priority"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/lib/nesting.test.ts`
Expected: FAIL — cannot find module `./nesting`.

- [ ] **Step 3: Implement `lib/nesting.ts`**

Create `frontend/src/features/tasks/lib/nesting.ts`:

```ts
import type { Task } from "../types";

export type NestBlockReason = "has-subtasks" | "repeating";

// A Subtask can only hold a title and done state (types.ts) — a task with
// its own subtasks, or one that's part of a repeat series (removing it has
// side effects on the rest of the series, not just data loss), can't be
// converted into a subtask at all.
export function nestBlockReasonFor(task: Task): NestBlockReason | undefined {
  if ((task.subtasks?.length ?? 0) > 0) return "has-subtasks";
  if ((task.repeatWeekdays?.length ?? 0) > 0 || task.repeatSourceId !== undefined) return "repeating";
  return undefined;
}

export function nestBlockMessage(reason: NestBlockReason): string {
  return reason === "has-subtasks"
    ? "This task already has subtasks and can't be nested."
    : "Repeating tasks must be detached from their series first.";
}

// Fields a Subtask can't represent — anything here is silently dropped when
// a task is converted, so the caller must confirm with the user first.
export function lostFieldsFor(task: Task): string[] {
  const fields: string[] = [];
  if (task.memo) fields.push("note");
  if (task.time) fields.push("time");
  if (task.durationMinutes) fields.push("duration");
  if (task.priority) fields.push("priority");
  if (task.dueDate) fields.push("due date");
  if (task.background) fields.push("background");
  return fields;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/lib/nesting.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Write the failing test for `convertTaskToSubtask`**

Append to `frontend/src/features/tasks/store.test.tsx`, inside the existing `describe("time and subtask actions", ...)` block (after the `"toggleSubtask flips one subtask; removeSubtask deletes it"` test):

```tsx
    it("convertTaskToSubtask moves a simple task into the target's subtasks and removes it", async () => {
      const source = makeTask({ id: "s", title: "buy milk", scope: { kind: "day", date: todayKey() } });
      const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([source, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "t"));

      expect(result.current.tasks.find((t) => t.id === "s")).toBeUndefined();
      const updatedTarget = result.current.tasks.find((t) => t.id === "t");
      expect(updatedTarget?.subtasks).toHaveLength(1);
      expect(updatedTarget?.subtasks![0]).toMatchObject({ title: "buy milk", done: false });
      await waitFor(() => expect(repo.tasks.find((t) => t.id === "s")).toBeUndefined());
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "t")?.subtasks).toHaveLength(1),
      );
    });

    it("convertTaskToSubtask preserves the source task's done state", async () => {
      const source = makeTask({
        id: "s",
        title: "done already",
        done: true,
        scope: { kind: "day", date: todayKey() },
      });
      const target = makeTask({ id: "t", title: "list", scope: { kind: "day", date: todayKey() } });
      const { result } = setup(fakeRepository([source, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "t"));

      expect(result.current.tasks.find((t) => t.id === "t")?.subtasks![0].done).toBe(true);
    });

    it("convertTaskToSubtask appends to any existing subtasks on the target", async () => {
      const source = makeTask({ id: "s", title: "new item", scope: { kind: "day", date: todayKey() } });
      const target = makeTask({
        id: "t",
        title: "list",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "existing", title: "already here", done: false }],
      });
      const { result } = setup(fakeRepository([source, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "t"));

      const updatedTarget = result.current.tasks.find((t) => t.id === "t");
      expect(updatedTarget?.subtasks).toHaveLength(2);
      expect(updatedTarget?.subtasks!.map((s) => s.title)).toEqual(["already here", "new item"]);
    });

    it("convertTaskToSubtask is a no-op when the source task already has subtasks", async () => {
      const source = makeTask({
        id: "s",
        title: "has kids",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "sub1", title: "step 1", done: false }],
      });
      const target = makeTask({ id: "t", title: "list", scope: { kind: "day", date: todayKey() } });
      const { result } = setup(fakeRepository([source, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "t"));

      expect(result.current.tasks.find((t) => t.id === "s")).toBeTruthy();
      expect(result.current.tasks.find((t) => t.id === "t")?.subtasks ?? []).toHaveLength(0);
    });

    it("convertTaskToSubtask is a no-op when the source task is a repeat anchor or occurrence", async () => {
      const anchor = makeTask({
        id: "anchor",
        title: "weekly review",
        scope: { kind: "day", date: todayKey() },
        repeatWeekdays: [4],
      });
      const occurrence = makeTask({
        id: "occ",
        title: "gym",
        scope: { kind: "day", date: todayKey() },
        repeatSourceId: "some-other-anchor",
      });
      const target = makeTask({ id: "t", title: "list", scope: { kind: "day", date: todayKey() } });
      const { result } = setup(fakeRepository([anchor, occurrence, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => {
        result.current.convertTaskToSubtask("anchor", "t");
        result.current.convertTaskToSubtask("occ", "t");
      });

      expect(result.current.tasks.find((t) => t.id === "anchor")).toBeTruthy();
      expect(result.current.tasks.find((t) => t.id === "occ")).toBeTruthy();
      expect(result.current.tasks.find((t) => t.id === "t")?.subtasks ?? []).toHaveLength(0);
    });

    it("convertTaskToSubtask is a no-op when dropped onto itself", async () => {
      const source = makeTask({ id: "s", title: "self", scope: { kind: "day", date: todayKey() } });
      const { result } = setup(fakeRepository([source]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "s"));

      expect(result.current.tasks.find((t) => t.id === "s")).toBeTruthy();
    });
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx -t "convertTaskToSubtask"`
Expected: FAIL — `result.current.convertTaskToSubtask is not a function`.

- [ ] **Step 7: Add `convertTaskToSubtask` to the store**

In `frontend/src/features/tasks/store.tsx`, add the import (alongside the existing `./lib/*` imports near the top of the file):

```ts
import { nestBlockReasonFor } from "./lib/nesting";
```

Add to the `TasksContextValue` interface, directly after `editSubtaskTitle`:

```ts
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  convertTaskToSubtask: (id: string, targetId: string) => void;
```

Add the implementation, directly after the `editSubtaskTitle` method and before `removeTask`:

```ts
      convertTaskToSubtask(id, targetId) {
        if (id === targetId) return;
        const source = state.tasks.find((t) => t.id === id);
        const target = state.tasks.find((t) => t.id === targetId);
        if (!source || !target) return;
        if (nestBlockReasonFor(source)) return;

        const updatedTarget: Task = {
          ...target,
          subtasks: [
            ...(target.subtasks ?? []),
            { id: crypto.randomUUID(), title: source.title, done: source.done },
          ],
        };
        dispatch({ type: "updated", task: updatedTarget });
        repo.update(updatedTarget).catch(handleSyncFailure);

        dispatch({ type: "removed", id });
        repo.remove(id).catch(handleSyncFailure);
      },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (every test in the file, including the 6 new ones)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/tasks/lib/nesting.ts frontend/src/features/tasks/lib/nesting.test.ts frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add nesting eligibility rules and convertTaskToSubtask action"
```

---

### Task 2: Extend `useDragToSchedule` with a `nest`/`nest-blocked` resolution

**Files:**
- Modify: `frontend/src/features/tasks/components/use-drag-to-schedule.ts`
- Modify: `frontend/src/features/tasks/components/use-drag-to-schedule.test.tsx`

**Interfaces:**
- Consumes: `NestBlockReason` from Task 1's `../lib/nesting`.
- Produces: `useDragToSchedule` now requires two new options, `cardRefs: React.RefObject<Record<string, HTMLElement | null>>` and `onNest: (sourceId: string, targetId: string) => void` and `onNestBlocked: (reason: NestBlockReason) => void`. `getDragHandlers` now takes a third argument, `nestBlockReason: NestBlockReason | undefined`. `DragState` gains `nestTargetId: string | null` and `nestBlockReason: NestBlockReason | undefined`. `onSchedule`'s own signature and behavior for the `clear-time`/`schedule` outcomes are unchanged. Task 4 wires all of this into `daily-view.tsx`/`day-agenda.tsx`/`day-timeline.tsx`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/use-drag-to-schedule.test.tsx`, replace the `Harness` component and `setup` function with a version that also wires `cardRefs`/`onNest`/`onNestBlocked`, and add a `nest-target` probe:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { NestBlockReason } from "../lib/nesting";
import { useDragToSchedule } from "./use-drag-to-schedule";

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
  onSchedule = () => {},
  onNest = () => {},
  onNestBlocked = () => {},
  chipANestBlockReason,
}: {
  onSchedule?: (id: string, time?: string) => void;
  onNest?: (sourceId: string, targetId: string) => void;
  onNestBlocked?: (reason: NestBlockReason) => void;
  chipANestBlockReason?: NestBlockReason;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    cardRefs,
    hourHeight: 48,
    onSchedule,
    onNest,
    onNestBlocked,
  });

  return (
    <div>
      <div ref={allDayZoneRef} data-testid="all-day">
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A", chipANestBlockReason)}>
          <button type="button" onClick={() => onSchedule("clicked-title", undefined)}>
            Task A
          </button>
        </div>
        <div data-testid="chip-target" ref={(el) => { cardRefs.current["target"] = el; }}>
          Target Task
        </div>
      </div>
      {/* A second, unrelated draggable item that shares the same hook instance
          (and therefore the same suppressClickRef) as chip-a, but is never
          itself dragged in these tests — used to prove the suppression flag
          doesn't leak across wrappers. */}
      <div data-testid="chip-b" {...getDragHandlers("b", "Task B", undefined)}>
        <button type="button" onClick={() => onSchedule("clicked-title-b", undefined)}>
          Task B
        </button>
      </div>
      <div ref={railRef} data-testid="rail" />
      <div data-testid="preview">{dragState ? (dragState.previewTime ?? "clear") : "none"}</div>
      <div data-testid="nest-target">{dragState?.nestTargetId ?? "none"}</div>
    </div>
  );
}

function setup(onSchedule = vi.fn()) {
  render(<Harness onSchedule={onSchedule} />);
  const rail = screen.getByTestId("rail");
  const allDay = screen.getByTestId("all-day");
  // Generously tall rail rect + scrollTop 0 so clientY maps directly to
  // content-relative y with no scroll arithmetic (see Global Constraints).
  mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
  Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
  mockRect(allDay, { top: 0, bottom: 90, left: 0, right: 300 });
  return { onSchedule, chip: screen.getByTestId("chip-a") };
}
```

Keep every existing `it(...)` block in the file exactly as-is below this point — none of them call `getDragHandlers` directly, they all go through `Harness`, and the rewritten `Harness` above already passes a third argument at both of its call sites (`chipANestBlockReason` for chip-a, `undefined` for chip-b). So the existing tests keep passing unmodified once `Harness` and `setup` are replaced.

Now append a new describe block at the end of the file, after the existing `describe("useDragToSchedule", ...)` block's closing `});`:

```tsx
describe("useDragToSchedule nesting", () => {
  function setupNest(nestBlockReason?: NestBlockReason) {
    const onSchedule = vi.fn();
    const onNest = vi.fn();
    const onNestBlocked = vi.fn();
    render(
      <Harness
        onSchedule={onSchedule}
        onNest={onNest}
        onNestBlocked={onNestBlocked}
        chipANestBlockReason={nestBlockReason}
      />,
    );
    const rail = screen.getByTestId("rail");
    const allDay = screen.getByTestId("all-day");
    const target = screen.getByTestId("chip-target");
    mockRect(rail, { top: 2000, bottom: 3000, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(allDay, { top: 0, bottom: 200, left: 0, right: 300 });
    mockRect(target, { top: 100, bottom: 150, left: 0, right: 300 });
    return { onSchedule, onNest, onNestBlocked, chip: screen.getByTestId("chip-a") };
  }

  it("resolves to nest and highlights the hovered card when the dragged task is eligible", () => {
    const { onNest, onSchedule, chip } = setupNest();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(screen.getByTestId("nest-target").textContent).toBe("target");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNest).toHaveBeenCalledWith("a", "target");
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("resolves to nest-blocked instead of nesting when the dragged task already has subtasks", () => {
    const { onNest, onNestBlocked, chip } = setupNest("has-subtasks");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNestBlocked).toHaveBeenCalledWith("has-subtasks");
    expect(onNest).not.toHaveBeenCalled();
  });

  it("resolves to nest-blocked for a repeating task", () => {
    const { onNestBlocked, chip } = setupNest("repeating");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNestBlocked).toHaveBeenCalledWith("repeating");
  });

  it("falls through to clearing the time when dropped in the all-day zone but not on a card", () => {
    const { onSchedule, onNest, chip } = setupNest();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 190 }); // inside all-day, outside target's 100-150 rect
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 190 });
    expect(onSchedule).toHaveBeenCalledWith("a", undefined);
    expect(onNest).not.toHaveBeenCalled();
  });

  it("excludes the dragged task's own card from nest hit-testing (self-drop falls through)", () => {
    const onNest = vi.fn();
    const onSchedule = vi.fn();

    function SelfDropHarness() {
      const railRef = useRef<HTMLDivElement>(null);
      const allDayZoneRef = useRef<HTMLDivElement>(null);
      const cardRefs = useRef<Record<string, HTMLElement | null>>({});
      const { getDragHandlers } = useDragToSchedule({
        railRef,
        allDayZoneRef,
        cardRefs,
        hourHeight: 48,
        onSchedule,
        onNest,
        onNestBlocked: () => {},
      });
      return (
        <div>
          <div ref={allDayZoneRef} data-testid="all-day">
            <div
              data-testid="chip-self"
              ref={(el) => {
                cardRefs.current["self"] = el;
              }}
              {...getDragHandlers("self", "Self Task", undefined)}
            />
          </div>
          <div ref={railRef} data-testid="rail" />
        </div>
      );
    }

    render(<SelfDropHarness />);
    const allDay = screen.getByTestId("all-day");
    const chip = screen.getByTestId("chip-self");
    mockRect(allDay, { top: 0, bottom: 200, left: 0, right: 300 });
    mockRect(chip, { top: 50, bottom: 100, left: 0, right: 300 });

    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 75 }); // inside its own rect
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 75 });

    expect(onNest).not.toHaveBeenCalled();
    expect(onSchedule).toHaveBeenCalledWith("self", undefined); // falls through to all-day-zone
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-schedule.test.tsx`
Expected: FAIL — `useDragToSchedule` doesn't accept `cardRefs`/`onNest`/`onNestBlocked` yet, `getDragHandlers` doesn't accept a third argument, `dragState.nestTargetId` is `undefined` (not `"target"`). TypeScript errors on the missing required options are also expected at this point.

- [ ] **Step 3: Implement the extended hook**

Replace the full contents of `frontend/src/features/tasks/components/use-drag-to-schedule.ts`:

```ts
"use client";

import { useCallback, useRef, useState } from "react";

import type { NestBlockReason } from "../lib/nesting";
import { yToSnappedTime } from "../lib/times";

const DRAG_THRESHOLD_PX = 10;
const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_STEP_PX = 12;

export interface DragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  previewTime: string | null;
  nestTargetId: string | null;
  nestBlockReason: NestBlockReason | undefined;
}

interface DragGesture {
  id: string;
  title: string;
  nestBlockReason: NestBlockReason | undefined;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

type Resolution =
  | { kind: "nest"; targetId: string }
  | { kind: "nest-blocked"; targetId: string; reason: NestBlockReason }
  | { kind: "clear-time" }
  | { kind: "schedule"; time: string }
  | { kind: "outside" };

export function useDragToSchedule(options: {
  railRef: React.RefObject<HTMLDivElement | null>;
  allDayZoneRef: React.RefObject<HTMLDivElement | null>;
  cardRefs: React.RefObject<Record<string, HTMLElement | null>>;
  hourHeight: number;
  onSchedule: (id: string, time: string | undefined) => void;
  onNest: (sourceId: string, targetId: string) => void;
  onNestBlocked: (reason: NestBlockReason) => void;
}) {
  const { railRef, allDayZoneRef, cardRefs, hourHeight, onSchedule, onNest, onNestBlocked } = options;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (
      clientX: number,
      clientY: number,
      sourceId: string,
      nestBlockReason: NestBlockReason | undefined,
    ): Resolution => {
      // Most specific target first: a card is more specific than the
      // broader zone (all-day zone / rail) it visually sits inside.
      for (const [id, el] of Object.entries(cardRefs.current)) {
        if (id === sourceId || !el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return nestBlockReason
            ? { kind: "nest-blocked", targetId: id, reason: nestBlockReason }
            : { kind: "nest", targetId: id };
        }
      }
      const allDayEl = allDayZoneRef.current;
      if (allDayEl) {
        const r = allDayEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return { kind: "clear-time" };
        }
      }
      const railEl = railRef.current;
      if (railEl) {
        const r = railEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const y = clientY - r.top + railEl.scrollTop;
          return { kind: "schedule", time: yToSnappedTime(y, hourHeight) };
        }
      }
      return { kind: "outside" };
    },
    [allDayZoneRef, railRef, cardRefs, hourHeight],
  );

  const autoScroll = useCallback(
    (clientY: number) => {
      const railEl = railRef.current;
      if (!railEl) return;
      const r = railEl.getBoundingClientRect();
      const nearRail = clientY >= r.top - EDGE_ZONE_PX && clientY <= r.bottom + EDGE_ZONE_PX;
      if (!nearRail) return;
      if (clientY - r.top < EDGE_ZONE_PX) {
        railEl.scrollTop = Math.max(0, railEl.scrollTop - AUTO_SCROLL_STEP_PX);
      } else if (r.bottom - clientY < EDGE_ZONE_PX) {
        railEl.scrollTop += AUTO_SCROLL_STEP_PX;
      }
    },
    [railRef],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string, nestBlockReason: NestBlockReason | undefined) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        gestureRef.current = {
          id,
          title,
          nestBlockReason,
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
          // target away from nested interactive elements (a checkbox, the
          // title button), since browsers retarget the click to whichever
          // element holds pointer capture.
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        autoScroll(e.clientY);
        const resolution = resolve(e.clientX, e.clientY, gesture.id, gesture.nestBlockReason);
        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          previewTime: resolution.kind === "schedule" ? resolution.time : null,
          nestTargetId:
            resolution.kind === "nest" || resolution.kind === "nest-blocked" ? resolution.targetId : null,
          nestBlockReason: resolution.kind === "nest-blocked" ? resolution.reason : undefined,
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
          // Safety net: if the source element unmounts before the browser's
          // post-pointerup click reaches onClickCapture (e.g. a cross-zone drop
          // that removes this wrapper from the DOM), the flag would otherwise
          // stay stuck true and swallow the next unrelated click.
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const resolution = resolve(e.clientX, e.clientY, gesture.id, gesture.nestBlockReason);
          switch (resolution.kind) {
            case "nest":
              onNest(gesture.id, resolution.targetId);
              break;
            case "nest-blocked":
              onNestBlocked(resolution.reason);
              break;
            case "clear-time":
              onSchedule(gesture.id, undefined);
              break;
            case "schedule":
              onSchedule(gesture.id, resolution.time);
              break;
            case "outside":
              break;
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
    [resolve, autoScroll, onSchedule, onNest, onNestBlocked],
  );

  return { dragState, getDragHandlers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-schedule.test.tsx`
Expected: PASS (all tests, including the 5 new nesting ones)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/use-drag-to-schedule.ts frontend/src/features/tasks/components/use-drag-to-schedule.test.tsx
git commit -m "feat: add nest/nest-blocked resolution to useDragToSchedule"
```

---

### Task 3: `ConvertToSubtaskDialog` confirmation overlay

**Files:**
- Create: `frontend/src/features/tasks/components/convert-to-subtask-dialog.tsx`
- Create: `frontend/src/features/tasks/components/convert-to-subtask-dialog.test.tsx`

**Interfaces:**
- Produces: `ConvertToSubtaskDialog({ sourceTitle, targetTitle, lostFields, onConfirm, onCancel })`. Task 4 renders this conditionally in `daily-view.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/convert-to-subtask-dialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConvertToSubtaskDialog } from "./convert-to-subtask-dialog";

describe("ConvertToSubtaskDialog", () => {
  it("names both tasks and lists the fields that will be lost", () => {
    render(
      <ConvertToSubtaskDialog
        sourceTitle="Buy milk"
        targetTitle="Groceries"
        lostFields={["time", "priority"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Buy milk/)).toBeTruthy();
    expect(screen.getByText(/Groceries/)).toBeTruthy();
    expect(screen.getByText(/time, priority/)).toBeTruthy();
  });

  it("calls onConfirm when Confirm is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("alertdialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the dialog card", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on Escape", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/convert-to-subtask-dialog.test.tsx`
Expected: FAIL — cannot find module `./convert-to-subtask-dialog`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/features/tasks/components/convert-to-subtask-dialog.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function ConvertToSubtaskDialog({
  sourceTitle,
  targetTitle,
  lostFields,
  onConfirm,
  onCancel,
}: {
  sourceTitle: string;
  targetTitle: string;
  lostFields: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="convert-to-subtask-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="convert-to-subtask-title" className="text-sm font-semibold text-foreground">
          Make &ldquo;{sourceTitle}&rdquo; a subtask of &ldquo;{targetTitle}&rdquo;?
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">This will lose: {lostFields.join(", ")}.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/convert-to-subtask-dialog.test.tsx`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/convert-to-subtask-dialog.tsx frontend/src/features/tasks/components/convert-to-subtask-dialog.test.tsx
git commit -m "feat: add ConvertToSubtaskDialog confirmation overlay"
```

---

### Task 4: Wire it into `DailyView`, `DayAgenda`, `DayTimeline`

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx`
- Modify: `frontend/src/features/tasks/components/day-agenda.tsx`
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx`
- Test: `frontend/src/features/tasks/components/views/daily-view.test.tsx`

**Interfaces:**
- Consumes: Task 1's `nestBlockReasonFor`, `lostFieldsFor`, `nestBlockMessage`, `NestBlockReason`; Task 2's extended `useDragToSchedule`/`DragState`; Task 3's `ConvertToSubtaskDialog`; the store's `convertTaskToSubtask`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/components/views/daily-view.test.tsx`, as a new `describe` block after the existing `describe("DailyView drag-to-schedule (cross-column)", ...)` block:

```tsx
describe("DailyView drag-to-nest-subtask", () => {
  function setupCards(source: ReturnType<typeof makeTask>, target: ReturnType<typeof makeTask>) {
    renderView(vi.fn(), [source, target]);
    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 2000, bottom: 3000, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 500, left: 400, right: 700 });
    mockRect(screen.getByTestId(`agenda-${target.id}`), { top: 100, bottom: 150, left: 400, right: 700 });
  }

  function dragOnto(sourceId: string) {
    const sourceEl = screen.getByTestId(`agenda-${sourceId}`);
    fireEvent.pointerDown(sourceEl, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });
    return sourceEl;
  }

  it("converts a simple dragged task into a subtask immediately, no confirmation", async () => {
    const source = makeTask({ id: "s", title: "buy milk", scope: { kind: "day", date: ANCHOR } });
    const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("agenda-s")).toBeNull());

    fireEvent.click(screen.getByText("groceries"));
    expect(await screen.findByText("buy milk")).toBeTruthy();
  });

  it("shows a confirmation dialog for a task with extra fields, and converts on Confirm", async () => {
    const source = makeTask({
      id: "s",
      title: "call plumber",
      memo: "ask about pricing",
      scope: { kind: "day", date: ANCHOR },
    });
    const target = makeTask({ id: "t", title: "house stuff", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/note/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy(); // not converted yet

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByTestId("agenda-s")).toBeNull());
  });

  it("cancelling the confirmation dialog leaves the task unchanged", async () => {
    const source = makeTask({
      id: "s",
      title: "call plumber",
      memo: "ask about pricing",
      scope: { kind: "day", date: ANCHOR },
    });
    const target = makeTask({ id: "t", title: "house stuff", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("shows a blocked message and does not convert when the dragged task already has subtasks", async () => {
    const source = makeTask({
      id: "s",
      title: "planning",
      scope: { kind: "day", date: ANCHOR },
      subtasks: [{ id: "sub1", title: "step 1", done: false }],
    });
    const target = makeTask({ id: "t", title: "project", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByText(/already has subtasks/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("shows a blocked message for a repeating task and does not convert", async () => {
    const source = makeTask({
      id: "s",
      title: "weekly review",
      scope: { kind: "day", date: ANCHOR },
      repeatWeekdays: [4],
    });
    const target = makeTask({ id: "t", title: "misc", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByText(/detached from their series/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("highlights the hovered target card while dragging an eligible task", async () => {
    const source = makeTask({ id: "s", title: "buy milk", scope: { kind: "day", date: ANCHOR } });
    const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: ANCHOR } });
    setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    dragOnto("s");
    expect(screen.getByTestId("agenda-t").className).toContain("ring-brand");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/daily-view.test.tsx -t "drag-to-nest-subtask"`
Expected: FAIL — `useDragToSchedule` in `daily-view.tsx` doesn't yet pass `cardRefs`/`onNest`/`onNestBlocked` (TypeScript/runtime error), `DayAgenda` doesn't populate a card-ref map, no dialog or blocked-message rendering exists yet.

- [ ] **Step 3: Update `day-timeline.tsx`**

In `frontend/src/features/tasks/components/day-timeline.tsx`, update the `GetDragHandlers` type (around line 24):

```tsx
type GetDragHandlers = (
  id: string,
  title: string,
  nestBlockReason: NestBlockReason | undefined,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};
```

Add the import, alongside the existing `use-drag-to-schedule` type import:

```tsx
import { nestBlockReasonFor, type NestBlockReason } from "../lib/nesting";
import type { DragState } from "./use-drag-to-schedule";
```

Update both call sites (the background-lane chip and the regular-lane chip) from `{...getDragHandlers(t.id, t.title)}` to:

```tsx
{...getDragHandlers(t.id, t.title, nestBlockReasonFor(t))}
```

- [ ] **Step 4: Update `day-agenda.tsx`**

In `frontend/src/features/tasks/components/day-agenda.tsx`, update imports:

```tsx
import { nestBlockReasonFor, type NestBlockReason } from "../lib/nesting";
```

and add a type import for `DragState`:

```tsx
import type { DragState } from "./use-drag-to-schedule";
```

Update the `GetDragHandlers` type (around line 18):

```tsx
type GetDragHandlers = (
  id: string,
  title: string,
  nestBlockReason: NestBlockReason | undefined,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};
```

Update `DayAgenda`'s props to accept `cardRefs` and `dragState`:

```tsx
export function DayAgenda({
  date,
  onSelectTask,
  agendaZoneRef,
  getDragHandlers,
  cardRefs,
  dragState,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  agendaZoneRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
  cardRefs: React.RefObject<Record<string, HTMLElement | null>>;
  dragState: DragState | null;
}) {
```

Update `renderCard`'s ref callback (currently only sets `reorderItemRefs` when `reorderable`) to always populate `cardRefs` too:

```tsx
        <div
          ref={(el) => {
            cardRefs.current[t.id] = el;
            if (reorderable) {
              reorderItemRefs.current[t.id] = el;
            }
          }}
          data-testid={`agenda-${t.id}`}
          className={cn(
            "flex touch-none items-center gap-1.5",
            transitions.get(t.id)?.animationClass,
            dragState?.nestTargetId === t.id &&
              (dragState.nestBlockReason ? "ring-2 ring-muted-foreground/40" : "ring-2 ring-brand"),
          )}
          {...getDragHandlers(t.id, t.title, nestBlockReasonFor(t))}
        >
```

- [ ] **Step 5: Update `daily-view.tsx`**

In `frontend/src/features/tasks/components/views/daily-view.tsx`, update imports:

```tsx
import { useEffect, useRef, useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";

import { todayKey, shortDateLabel, upcomingRepeatDates } from "../../lib/dates";
import { lostFieldsFor, nestBlockMessage, type NestBlockReason } from "../../lib/nesting";
import { resolveRepeatWeekdays } from "../../lib/times";
import { useTasks } from "../../store";
import { ConvertToSubtaskDialog } from "../convert-to-subtask-dialog";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToSchedule } from "../use-drag-to-schedule";
import type { CalendarViewProps } from "./weekly-view";
```

Add state and handlers, directly after the existing `const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);` line:

```tsx
  const [pendingConversion, setPendingConversion] = useState<{
    sourceId: string;
    targetId: string;
    sourceTitle: string;
    targetTitle: string;
    lostFields: string[];
  } | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!blockedMessage) return;
    const timer = setTimeout(() => setBlockedMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [blockedMessage]);

  function handleNest(sourceId: string, targetId: string) {
    const source = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!source || !target) return;
    const lostFields = lostFieldsFor(source);
    if (lostFields.length === 0) {
      actions.convertTaskToSubtask(sourceId, targetId);
      return;
    }
    setPendingConversion({
      sourceId,
      targetId,
      sourceTitle: source.title,
      targetTitle: target.title,
      lostFields,
    });
  }

  function handleNestBlocked(reason: NestBlockReason) {
    setBlockedMessage(nestBlockMessage(reason));
  }
```

Add a `cardRefs` ref alongside the existing `railRef`/`agendaZoneRef`:

```tsx
  const railRef = useRef<HTMLDivElement>(null);
  const agendaZoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef: agendaZoneRef,
    cardRefs,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
    onNest: handleNest,
    onNestBlocked: handleNestBlocked,
  });
```

Pass `cardRefs` and `dragState` to `DayAgenda`:

```tsx
          <DayAgenda
            date={anchor}
            onSelectTask={handleSelectTask}
            agendaZoneRef={agendaZoneRef}
            getDragHandlers={getDragHandlers}
            cardRefs={cardRefs}
            dragState={dragState}
          />
```

Add the blocked-message banner as the first child of the returned fragment, and the confirmation dialog as the last child (the existing `return (<> ... </>)` structure — insert immediately after the opening `<>`, before `<div data-testid="daily-layout" ...>`, and immediately before the closing `</>`):

```tsx
    <>
      {blockedMessage && (
        <div className="shrink-0 px-10 pt-3">
          <Alert variant="destructive">
            <AlertTitle>{blockedMessage}</AlertTitle>
            <AlertAction>
              <button
                type="button"
                onClick={() => setBlockedMessage(null)}
                className="text-xs text-destructive/70 underline hover:text-destructive"
              >
                Dismiss
              </button>
            </AlertAction>
          </Alert>
        </div>
      )}
      <div
        data-testid="daily-layout"
        ...
```

```tsx
      {pendingConversion && (
        <ConvertToSubtaskDialog
          sourceTitle={pendingConversion.sourceTitle}
          targetTitle={pendingConversion.targetTitle}
          lostFields={pendingConversion.lostFields}
          onConfirm={() => {
            actions.convertTaskToSubtask(pendingConversion.sourceId, pendingConversion.targetId);
            setPendingConversion(null);
          }}
          onCancel={() => setPendingConversion(null)}
        />
      )}
    </>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS (every test in the file, including the 6 new ones — and every pre-existing drag-to-schedule test still passes, confirming the `nest`-check-first ordering doesn't regress rail/all-day-zone behavior)

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — no regressions elsewhere (`day-agenda.test.tsx`, `day-timeline.test.tsx`, and anything else that renders these components with the old prop shapes would fail to compile/run if a call site was missed).

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean — confirms every `getDragHandlers`/`useDragToSchedule` call site across the codebase was updated (a missed call site is a compile error, not a silent runtime gap, since the new parameters are required).

- [ ] **Step 9: Manual verification in the browser**

Start the dev server (`cd frontend && npm run dev`) and in Daily view:
- Drag a plain task (no memo/time/priority/etc.) onto another task — it should convert immediately, no dialog, and appear as a subtask when you open the target's detail drawer.
- Drag a task with a memo or due date onto another task — the confirmation dialog should appear listing exactly those fields; Cancel leaves it untouched, Confirm converts it.
- Drag a task that already has subtasks onto another task — a brief message should appear explaining it can't be nested, and nothing should convert.
- Drag a task that's part of a repeat series onto another task — a brief message should appear about detaching it first.
- While dragging an eligible task, hover over another card and confirm it highlights; drop on the rail or the empty all-day area and confirm scheduling still works exactly as before (no regression).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.tsx frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: wire drag-to-nest-subtask into Daily view"
```
