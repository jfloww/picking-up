# Drag-to-Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Daily-view task's time be set by dragging — all-day → rail sets it, rail → rail reschedules it, rail → all-day clears it — with 15-minute snapping, a live ghost + preview line, auto-scroll near the rail's edges, and side-by-side columns for same-time collisions.

**Architecture:** Pure math (Y-position → snapped time; same-time grouping into columns) lives in `lib/times.ts`. A new reusable `useDragToSchedule` hook owns all pointer-event mechanics (drag detection, drop-target resolution, click suppression, auto-scroll) and is driven purely by two refs (`railRef`, `allDayZoneRef`) and a callback — it has no knowledge of tasks or the store. `DayTimeline` wires the hook onto each chip, renders the ghost/preview line, and applies the column layout; on drop it calls the **existing** `setTime` store action — no schema, store, or repository changes. Spec: `docs/superpowers/specs/2026-07-17-drag-to-schedule-design.md`.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, native Pointer Events (no new dependency), Vitest + Testing Library (jsdom 29, which implements a working `PointerEvent` but **not** `Element.prototype.setPointerCapture` — see Global Constraints).

## Global Constraints

- Work on branch `feat/drag-to-schedule` (create from `main` before Task 1).
- All commands run inside `frontend/`.
- Times are `"HH:MM"` strings (24h, zero-padded), exactly as `isValidTime`/`setTime` already expect — a drag never produces anything other than a value `isValidTime` would accept.
- No new npm dependency — drag is implemented with native Pointer Events.
- **jsdom does not implement `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture`** (confirmed: `typeof element.setPointerCapture === "undefined"` under this project's jsdom 29.1.1). Any code calling these MUST guard with `typeof target.setPointerCapture === "function"` — this is not a test-only workaround, it's defensive production code that happens to also make jsdom safe.
- `fireEvent.pointerDown/pointerMove/pointerUp/pointerCancel(element, { pointerId, clientX, clientY })` correctly delivers those properties to React's synthetic event in this project's test setup (verified directly against the real toolchain before writing this plan) — always dispatch on the same element you want the handler to see the event on; jsdom does no hit-testing based on coordinates.
- When mocking `getBoundingClientRect` in tests, remember it's the pointer's **screen-space** position (`clientY`) that must fall within a mocked rect's `top`/`bottom` for "is the pointer over this element" checks — not the content-relative scroll position. Keep test rail rects generously tall (e.g. `{ top: 0, bottom: 1200 }`) with `scrollTop: 0` so `clientY` maps directly to content-relative Y with no scroll arithmetic needed in the test itself.
- No legacy CSS classes — Tailwind utilities with existing tokens only (`bg-brand`, `text-primary-foreground`, `bg-card`, `ring-brand/40`, `border-brand`, …).
- Interactive components need `"use client"`.
- Tests must not depend on the wall clock where `DayTimeline` reads it — pin with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` (already the pattern in `day-timeline.test.tsx`).
- Commit style: conventional commits, each message ending with the line:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 1: Pure math — snapping and column layout

**Files:**
- Modify: `frontend/src/features/tasks/lib/times.ts` (append)
- Test: `frontend/src/features/tasks/lib/times.test.ts` (append)

**Interfaces:**
- Consumes: `Task` from `../types` (already imported in this file).
- Produces:
  - `yToSnappedTime(y: number, hourHeight: number, snapMinutes?: number): string` — converts a content-relative pixel offset on the rail into a snapped `"HH:MM"` string. Default `snapMinutes = 15`. Clamps output to `"00:00"`..`"23:45"` (the last on-grid 15-minute slot).
  - `interface TimedTaskLayout { task: Task; column: number; columns: number }`
  - `layoutTimedTasks(timed: Task[]): TimedTaskLayout[]` — groups tasks sharing an identical `time` value; each task gets its index within its group (`column`) and the group's size (`columns`). A task with a unique time gets `{ column: 0, columns: 1 }`. Output preserves the input array's order. Assumes every task in `timed` has `time` set (same precondition `DayTimeline`'s existing `timed` filter already guarantees).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/lib/times.test.ts` (add `layoutTimedTasks, yToSnappedTime` to the existing import from `./times`):

```ts
describe("yToSnappedTime", () => {
  it("converts a content-relative y offset to a snapped HH:MM", () => {
    expect(yToSnappedTime(456, 48)).toBe("09:30"); // 570 minutes exactly
    expect(yToSnappedTime(0, 48)).toBe("00:00");
  });

  it("rounds to the nearest 15-minute slot", () => {
    expect(yToSnappedTime(457.6, 48)).toBe("09:30"); // 572 min -> rounds down to 570
    expect(yToSnappedTime(462.4, 48)).toBe("09:45"); // 578 min -> rounds up to 585
  });

  it("clamps to 00:00..23:45", () => {
    expect(yToSnappedTime(-50, 48)).toBe("00:00");
    expect(yToSnappedTime(100000, 48)).toBe("23:45");
  });

  it("honors a custom snap grid", () => {
    expect(yToSnappedTime(456, 48, 30)).toBe("09:30");
    expect(yToSnappedTime(464, 48, 30)).toBe("09:30"); // 580 min -> nearest 30 is 570, not a tie
  });
});

describe("layoutTimedTasks", () => {
  function task(overrides: Partial<Task>): Task {
    return {
      id: crypto.randomUUID(),
      title: "t",
      done: false,
      scope: { kind: "day", date: "2026-07-16" },
      createdAt: "2026-07-16T00:00:00.000Z",
      ...overrides,
    };
  }

  it("gives unique-time tasks a single full-width column", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "10:00" });
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 1 },
      { task: b, column: 0, columns: 1 },
    ]);
  });

  it("splits same-time tasks into indexed columns", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "09:00" });
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 2 },
      { task: b, column: 1, columns: 2 },
    ]);
  });

  it("groups independently by time when some tasks collide and others don't", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "09:00" });
    const c = task({ time: "11:00" });
    expect(layoutTimedTasks([a, b, c])).toEqual([
      { task: a, column: 0, columns: 2 },
      { task: b, column: 1, columns: 2 },
      { task: c, column: 0, columns: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/times.test.ts`
Expected: FAIL — `yToSnappedTime`/`layoutTimedTasks` not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/features/tasks/lib/times.ts`:

```ts
export function yToSnappedTime(
  y: number,
  hourHeight: number,
  snapMinutes = 15,
): string {
  const totalMinutes = (y / hourHeight) * 60;
  const snapped = Math.round(totalMinutes / snapMinutes) * snapMinutes;
  const clamped = Math.min(Math.max(snapped, 0), 23 * 60 + 45);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface TimedTaskLayout {
  task: Task;
  column: number;
  columns: number;
}

export function layoutTimedTasks(timed: Task[]): TimedTaskLayout[] {
  const groups = new Map<string, Task[]>();
  for (const task of timed) {
    const key = task.time!;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }

  return timed.map((task) => {
    const group = groups.get(task.time!)!;
    return { task, column: group.indexOf(task), columns: group.length };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/times.test.ts`
Expected: PASS (all, including the pre-existing tests in this file).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/lib/times.ts src/features/tasks/lib/times.test.ts
git commit -m "feat: add time-snapping and column-layout math for drag-to-schedule"
```

---

### Task 2: `useDragToSchedule` hook

**Files:**
- Create: `frontend/src/features/tasks/components/use-drag-to-schedule.ts`
- Test: `frontend/src/features/tasks/components/use-drag-to-schedule.test.tsx`

**Interfaces:**
- Consumes: `yToSnappedTime` from `../lib/times` (Task 1).
- Produces:
  - `interface DragState { id: string; title: string; pointerY: number; previewTime: string | null }` — `previewTime` is `null` while the pointer is over the all-day zone (meaning "will clear"), and also `null` when the pointer is over neither zone.
  - `useDragToSchedule(options: { railRef: React.RefObject<HTMLDivElement | null>; allDayZoneRef: React.RefObject<HTMLDivElement | null>; hourHeight: number; onSchedule: (id: string, time: string | undefined) => void }): { dragState: DragState | null; getDragHandlers: (id: string, title: string) => { onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: (e: React.PointerEvent) => void; onPointerCancel: (e: React.PointerEvent) => void; onClickCapture: (e: React.MouseEvent) => void } }`
  - Behavior: a plain click (pointerdown+pointerup with movement under 6px) never calls `onSchedule` and never suppresses the resulting click. A real drag (movement past the threshold) calls `onSchedule(id, snappedTime)` when released over the rail, `onSchedule(id, undefined)` when released over the all-day zone, and does not call `onSchedule` at all when released over neither — and suppresses the click that follows.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/use-drag-to-schedule.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

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

function Harness({ onSchedule }: { onSchedule: (id: string, time?: string) => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    hourHeight: 48,
    onSchedule,
  });

  return (
    <div>
      <div ref={allDayZoneRef} data-testid="all-day">
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A")}>
          <button type="button" onClick={() => onSchedule("clicked-title", undefined)}>
            Task A
          </button>
        </div>
      </div>
      <div ref={railRef} data-testid="rail" />
      <div data-testid="preview">{dragState ? (dragState.previewTime ?? "clear") : "none"}</div>
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

describe("useDragToSchedule", () => {
  it("does not schedule on a plain click (no movement past the threshold)", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule).toHaveBeenCalledWith("clicked-title", undefined);
  });

  it("schedules a snapped time when dropped on the rail, and shows a preview while dragging", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 }); // rail-relative y=456 -> 09:30
    expect(screen.getByTestId("preview").textContent).toBe("09:30");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(onSchedule).toHaveBeenCalledWith("a", "09:30");
    expect(screen.getByTestId("preview").textContent).toBe("none");
  });

  it("clears the time when dropped on the all-day zone", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    expect(screen.getByTestId("preview").textContent).toBe("clear");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    expect(onSchedule).toHaveBeenCalledWith("a", undefined);
  });

  it("is a no-op when dropped outside both zones", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 2000 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 2000 });
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onSchedule).toHaveBeenCalledTimes(1); // only the schedule call
    expect(onSchedule).toHaveBeenCalledWith("a", "09:30");
  });

  it("cancels cleanly on pointercancel without scheduling", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.pointerCancel(chip, { pointerId: 1 });
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview").textContent).toBe("none");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/use-drag-to-schedule.test.tsx`
Expected: FAIL — cannot resolve `./use-drag-to-schedule`.

- [ ] **Step 3: Implement `use-drag-to-schedule.ts`**

```ts
"use client";

import { useCallback, useRef, useState } from "react";

import { yToSnappedTime } from "../lib/times";

const DRAG_THRESHOLD_PX = 6;
const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_STEP_PX = 12;

export interface DragState {
  id: string;
  title: string;
  pointerY: number;
  previewTime: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface Resolution {
  overAllDay: boolean;
  time: string | null;
}

export function useDragToSchedule(options: {
  railRef: React.RefObject<HTMLDivElement | null>;
  allDayZoneRef: React.RefObject<HTMLDivElement | null>;
  hourHeight: number;
  onSchedule: (id: string, time: string | undefined) => void;
}) {
  const { railRef, allDayZoneRef, hourHeight, onSchedule } = options;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number): Resolution => {
      const allDayEl = allDayZoneRef.current;
      if (allDayEl) {
        const r = allDayEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return { overAllDay: true, time: null };
        }
      }
      const railEl = railRef.current;
      if (railEl) {
        const r = railEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const y = clientY - r.top + railEl.scrollTop;
          return { overAllDay: false, time: yToSnappedTime(y, hourHeight) };
        }
      }
      return { overAllDay: false, time: null };
    },
    [allDayZoneRef, railRef, hourHeight],
  );

  const autoScroll = useCallback(
    (clientY: number) => {
      const railEl = railRef.current;
      if (!railEl) return;
      const r = railEl.getBoundingClientRect();
      if (clientY - r.top < EDGE_ZONE_PX) {
        railEl.scrollTop = Math.max(0, railEl.scrollTop - AUTO_SCROLL_STEP_PX);
      } else if (r.bottom - clientY < EDGE_ZONE_PX) {
        railEl.scrollTop += AUTO_SCROLL_STEP_PX;
      }
    },
    [railRef],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        gestureRef.current = {
          id,
          title,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        const target = e.currentTarget as HTMLElement;
        if (typeof target.setPointerCapture === "function") {
          target.setPointerCapture(e.pointerId);
        }
      },
      onPointerMove: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;

        if (!gesture.moved) {
          const dx = e.clientX - gesture.startX;
          const dy = e.clientY - gesture.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          gesture.moved = true;
        }

        const { time } = resolve(e.clientX, e.clientY);
        setDragState({ id: gesture.id, title: gesture.title, pointerY: e.clientY, previewTime: time });
        autoScroll(e.clientY);
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
          const { overAllDay, time } = resolve(e.clientX, e.clientY);
          if (overAllDay) {
            onSchedule(gesture.id, undefined);
          } else if (time !== null) {
            onSchedule(gesture.id, time);
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
    [resolve, autoScroll, onSchedule],
  );

  return { dragState, getDragHandlers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/use-drag-to-schedule.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expect all green (no regressions).

```bash
git add src/features/tasks/components/use-drag-to-schedule.ts src/features/tasks/components/use-drag-to-schedule.test.tsx
git commit -m "feat: add useDragToSchedule pointer-event hook"
```

---

### Task 3: DayTimeline integration — ghost, preview line, columns, wiring

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx` (full replacement below)
- Modify: `frontend/src/features/tasks/components/day-timeline.test.tsx` (append new tests; existing 3 tests must still pass unchanged)

**Interfaces:**
- Consumes: `useDragToSchedule` from `./use-drag-to-schedule` (Task 2) — its return value's `dragState` is used with its inferred `DragState` shape (`{ id, title, pointerY, previewTime }`), no explicit type import needed; `layoutTimedTasks` from `../lib/times` (Task 1); existing `todayKey`, `compareTasksForDay`, `nowTime`, `timeToMinutes`, `useTasks`, `scopeKey`, `Scope`, `QuickAdd`, `TaskItem`, `taskItemHandlers` (all unchanged).
- Produces: `DayTimeline` unchanged export signature (`{ date: string }`); `HOUR_HEIGHT` still exported (unchanged value, 48).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, change the existing import line

```tsx
import { render, screen, waitFor } from "@testing-library/react";
```

to add `fireEvent` (`vi` is already imported from `vitest`, no change needed there):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
```

Then append the rest below the existing tests:

```tsx
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

describe("DayTimeline drag-to-schedule", () => {
  it("dragging an all-day task onto the rail sets its time", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    renderTimeline(day, [untimed]);
    await waitFor(() => expect(screen.getByTestId("all-day-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const source = screen.getByTestId("all-day-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 }); // -> 09:30
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });

    await waitFor(() => expect(screen.getByTestId("chip-u")).toBeTruthy());
    expect(screen.getByTestId("chip-u").style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`);
  });

  it("dragging a rail chip back onto the all-day zone clears its time", async () => {
    const day = todayKey();
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: day } });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 50 });

    await waitFor(() => expect(screen.getByTestId("all-day-t")).toBeTruthy());
    expect(screen.queryByTestId("chip-t")).toBeNull();
  });

  it("lays out same-time chips in side-by-side columns", async () => {
    const day = todayKey();
    const a = makeTask({ id: "a", title: "a", time: "09:00", scope: { kind: "day", date: day } });
    const b = makeTask({ id: "b", title: "b", time: "09:00", scope: { kind: "day", date: day } });
    renderTimeline(day, [a, b]);
    await waitFor(() => expect(screen.getByTestId("chip-a")).toBeTruthy());

    expect(screen.getByTestId("chip-a").style.width).toBe("calc(50% - 4px)");
    expect(screen.getByTestId("chip-b").style.width).toBe("calc(50% - 4px)");
    expect(screen.getByTestId("chip-a").style.left).toBe("calc(0% + 2px)");
    expect(screen.getByTestId("chip-b").style.left).toBe("calc(50% + 2px)");
  });

  it("shows a ghost and preview line while dragging, and hides both after drop", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    renderTimeline(day, [untimed]);
    await waitFor(() => expect(screen.getByTestId("all-day-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const source = screen.getByTestId("all-day-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 });

    expect(screen.getByTestId("drag-ghost").textContent).toBe("untimed");
    expect(screen.getByTestId("drag-preview-line").textContent).toBe("09:30");

    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — no `all-day-zone`/`all-day-u`/`drag-ghost`/`drag-preview-line` test ids exist yet; chips have no `left`/`width` styles.

- [ ] **Step 3: Replace the full contents of `day-timeline.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import { useDragToSchedule } from "./use-drag-to-schedule";

export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // mornings visible by default

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

export function DayTimeline({ date }: { date: string }) {
  const actions = useTasks();
  const { tasks, addTask, setTime } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);
  const allDay = dayTasks.filter((t) => !t.time);
  const timed = dayTasks.filter((t) => t.time).sort(compareTasksForDay);
  const isToday = date === todayKey();

  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (railRef.current) {
      railRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date]);

  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
  });

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div ref={allDayZoneRef} data-testid="all-day-zone">
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          All-day
        </div>
        <ul className="space-y-1">
          {allDay.map((t) => (
            <div key={t.id} data-testid={`all-day-${t.id}`} {...getDragHandlers(t.id, t.title)}>
              <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
            </div>
          ))}
        </ul>
        <QuickAdd onAdd={(title) => addTask(title, scope)} />
      </div>

      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative max-h-96 min-h-48 overflow-y-auto rounded-md border border-border/60"
      >
        <div className="relative" style={{ height: RAIL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              <span className="pl-1 text-[10px] tabular-nums text-subtle">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          ))}

          {isToday && (
            <div
              data-testid="now-line"
              className="absolute inset-x-0 z-10 border-t-2 border-brand"
              style={{ top: toOffset(nowTime()) }}
            />
          )}

          {layoutTimedTasks(timed).map(({ task: t, column, columns }) => (
            <div
              key={t.id}
              data-testid={`chip-${t.id}`}
              className="absolute z-20 rounded-md bg-brand/10 px-1 ring-1 ring-brand/30 focus-within:z-30"
              style={{
                top: toOffset(t.time!),
                left: `calc(${(column / columns) * 100}% + 2px)`,
                width: `calc(${100 / columns}% - 4px)`,
              }}
              {...getDragHandlers(t.id, t.title)}
            >
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}

          {dragState?.previewTime && (
            <div
              data-testid="drag-preview-line"
              className="pointer-events-none absolute inset-x-0 z-40 border-t-2 border-dashed border-brand"
              style={{ top: toOffset(dragState.previewTime) }}
            >
              <span className="bg-brand px-1 text-[10px] text-primary-foreground">
                {dragState.previewTime}
              </span>
            </div>
          )}
        </div>
      </div>

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: (railRef.current?.getBoundingClientRect().left ?? 0) + 8,
          }}
        >
          {dragState.title}
        </div>
      )}
    </div>
  );
}
```

Note the `all-day-zone` test id moved from an implicit wrapper to the ref'd div directly, and each all-day task is now wrapped in its own draggable `<div data-testid="all-day-<id>">` (previously all-day items rendered as bare `<TaskItem>` inside one shared `<ul>` — this task-per-wrapper change is required so each item has its own drop/drag-source target).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (all — the 3 pre-existing tests plus the 4 new ones, 7 total).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expect all green (no regressions in `daily-view.test.tsx` or elsewhere, since `DayTimeline`'s public props/exports are unchanged).

```bash
git add src/features/tasks/components/day-timeline.tsx src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: wire drag-to-schedule into the daily timeline"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full automated verification**

```bash
npm test        # all suites green
npm run lint    # clean
npm run build   # compiles
```

- [ ] **Step 2: Manual verification**

Run `npm run dev` and check `http://localhost:10050/app` on the Daily view (requires a login session — if unavailable in this environment, note every item below as deferred to the user rather than skipping silently):

1. Add a task via the all-day quick-add, then drag it down onto the rail — it should follow a ghost while dragging, show a preview line + time label snapped to 15-minute increments, and land at that time on release.
2. Drag an already-timed chip to a different hour — it reschedules smoothly.
3. Drag a timed chip back up into the all-day section — it clears its time and reappears in the all-day list.
4. Drag a chip and release it somewhere that's neither the rail nor the all-day zone (e.g. off to the side) — nothing changes.
5. Create two tasks at the same time (via drag or the manual time input) — both render side-by-side on the rail, not overlapping.
6. Start a drag near the bottom edge of the visible rail and hold there — the rail auto-scrolls to reveal later hours; same check near the top edge for earlier hours.
7. Click a chip's title normally (no drag) — the expanded editor (time input, memo, subtasks, delete) still opens exactly as before.
8. Confirm the manual time input + Clear button in the expanded editor still work independently of drag (unchanged from the merged daily-timeline feature).

- [ ] **Step 3: Report**

No commit for this task (verification only) — if manual checks are deferred, say so explicitly rather than claiming completion.
