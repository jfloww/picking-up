# Daily Tab Agenda Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Daily tab's left column to just the hour-rail, replace the right column's "Weekly" rollup list with a big-card "All day" agenda showing today's full task list, and rework drag-to-schedule to span both columns.

**Architecture:** Four tasks, each independently testable: (1) `TaskItem` gains a `size="large"` card variant; (2) `DayTimeline` is stripped down to just the rail, accepting drag state/refs/handlers as props instead of owning them; (3) a new `DayAgenda` component renders today's full task list as large cards with a pinned quick-add; (4) `DailyView` is rewritten to own the lifted `useDragToSchedule` call and wire both children together, including migrating every drag-behavior test that can no longer be exercised through `DayTimeline` alone.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Vitest + Testing Library. All commands below run from the `frontend/` directory.

## Global Constraints

- No changes to `use-drag-to-schedule.ts` — its gesture logic (pointer capture, `getBoundingClientRect` hit-testing, auto-scroll, click-suppression) already works purely off two ref'd elements' bounding rects and has no assumption about DOM tree position. Only the call site moves.
- Every prop addition to a shared component (`TaskItem`) is optional with a safe default, so no existing caller changes behavior/appearance.
- The timeline (left column) visual stays exactly as today — no size or layout changes to rail chips, hour markings, now-line, or drag-preview line. Only the right column and the removed all-day zone change size/style.
- `TaskItem`'s new `size="large"` variant: title `text-base` (16px) → `text-2xl` (24px, exactly 1.5x), checkbox `size-4` → `size-5`, time badge moves from before the title to after it, card gets a visible `bg-card ring-1 ring-border/60` treatment with `p-3` padding. Subtask badge / repeat pill / rolled-over icon scale up modestly (`text-[10px]`→`text-xs`, `size-3`→`size-4`) but keep their existing relative order (after the time).
- Test conventions: fake timers pinned to `2026-07-16 14:05` (Thursday) where "today" matters, `fakeRepository`/`makeTask` from `test-utils.tsx`, `TasksProvider` wrapping every render, matching the existing files' established style exactly.

---

### Task 1: `TaskItem` — add a `size="large"` card variant

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Produces: `TaskItem` accepts a new optional `size?: "default" | "large"` prop (default `"default"` — every existing caller unaffected). When `"large"`: bigger title (`text-2xl font-semibold`), bigger checkbox (`size-5`), a visible card look (`bg-card p-3 ring-1 ring-border/60`) replacing the default's plain `py-1.5`, and the time badge renders *after* the title button instead of before it. Consumed by Task 3 (`DayAgenda`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add these two `it` blocks inside the existing `describe("TaskItem v2", ...)` block (after the `dateLabel` test):

```ts
  it("renders large size with a bigger title and time after the title", () => {
    render(
      <TaskItem
        task={makeTask({ title: "big task", time: "09:00" })}
        {...noopHandlers}
        size="large"
      />,
    );
    const title = screen.getByRole("button", { name: "big task" });
    expect(title.className).toContain("text-2xl");
    const row = title.parentElement!;
    const children = Array.from(row.children);
    const timeEl = screen.getByText("09:00");
    expect(children.indexOf(timeEl)).toBeGreaterThan(children.indexOf(title));
  });

  it("defaults to the compact size with time before the title", () => {
    render(
      <TaskItem task={makeTask({ title: "small task", time: "09:00" })} {...noopHandlers} />,
    );
    const title = screen.getByRole("button", { name: "small task" });
    expect(title.className).toContain("text-base");
    expect(title.className).not.toContain("text-2xl");
    const row = title.parentElement!;
    const children = Array.from(row.children);
    const timeEl = screen.getByText("09:00");
    expect(children.indexOf(timeEl)).toBeLessThan(children.indexOf(title));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx -t "size"`
Expected: FAIL — `size` isn't a recognized prop, so the title never gets `text-2xl` and the time badge never moves after the title.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/task-item.tsx`, replace the whole file:

```tsx
"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
}

// Builds TaskItem's callback props from store actions; shared by ScopeTasks
// and DayTimeline so the wiring lives in one place.
export function taskItemHandlers(id: string, actions: TaskItemActions) {
  return {
    onToggle: () => actions.toggleTask(id),
    onMemoChange: (memo: string) => actions.setMemo(id, memo),
    onTimeChange: (time?: string) => actions.setTime(id, time),
    onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}

export function TaskItem({
  task,
  dateLabel,
  highlight,
  repeatLabel,
  size = "default",
  onToggle,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onSelect,
}: {
  task: Task;
  dateLabel?: string;
  highlight?: "overdue" | "pending";
  repeatLabel?: string;
  size?: "default" | "large";
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;
  const large = size === "large";

  const timeBadge = task.time && (
    <span
      className={cn("shrink-0 tabular-nums text-subtle", large ? "text-sm" : "text-xs")}
    >
      {task.time}
    </span>
  );

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md",
          large ? "bg-card p-3 ring-1 ring-border/60" : "py-1.5",
          highlight === "overdue" && "border-l-2 border-destructive bg-destructive/10 pl-1.5",
          highlight === "pending" && "border-l-2 border-warning bg-warning/10 pl-1.5",
        )}
      >
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
          className={large ? "size-5" : undefined}
        />
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
        {!large && timeBadge}
        <button
          type="button"
          onClick={() => (onSelect ? onSelect() : setOpen((o) => !o))}
          className={cn(
            "min-w-0 flex-1 truncate text-left font-medium",
            large ? "text-2xl font-semibold" : "text-base",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
        {large && timeBadge}
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className={cn(
              "shrink-0 rounded bg-muted tabular-nums text-muted-foreground",
              large ? "px-1.5 text-xs" : "px-1 text-[10px]",
            )}
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {repeatLabel && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-xs" : "px-1 text-[10px]",
            )}
          >
            {repeatLabel}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw
            aria-label="Rolled over"
            className={cn("shrink-0 text-subtle", large ? "size-4" : "size-3")}
          />
        )}
      </div>
      {open && (
        <div className="mt-1 pl-6">
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS, entire file green (confirms no existing `TaskItem`/`ScopeTasks`/`PeriodCell` test broke — every existing caller omits `size`, so nothing about them changes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add a size=large card variant to TaskItem"
```

---

### Task 2: Strip `DayTimeline` down to just the rail

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx`
- Test: `frontend/src/features/tasks/components/day-timeline.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `DragState` type from `./use-drag-to-schedule` (import only — the hook itself is not called here anymore).
- Produces: `DayTimeline` no longer renders an all-day zone, no longer calls `useDragToSchedule`, no longer renders the drag-ghost overlay. New props: `railRef: React.RefObject<HTMLDivElement | null>` (required — the caller now owns and creates this ref), `getDragHandlers: (id: string, title: string) => { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }` (required — wraps each rail chip), `dragState: DragState | null` (required — only used to position the drag-preview line on the rail). `HOUR_HEIGHT` stays exported unchanged. Consumed by Task 4 (`DailyView`).

- [ ] **Step 1: Write the failing tests (full file rewrite)**

Replace the entire contents of `frontend/src/features/tasks/components/day-timeline.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { todayKey } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayTimeline, HOUR_HEIGHT } from "./day-timeline";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5)); // Thu 2026-07-16 14:05
});
afterAll(() => {
  vi.useRealTimers();
});

const noopGetDragHandlers = () => ({
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onClickCapture: () => {},
});

function renderTimeline(
  date: string,
  tasks = [] as Parameters<typeof fakeRepository>[0],
  onSelectTask?: (id: string) => void,
) {
  const railRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const utils = render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayTimeline
        date={date}
        onSelectTask={onSelectTask}
        railRef={railRef}
        getDragHandlers={noopGetDragHandlers}
        dragState={null}
      />
    </TasksProvider>,
  );
  return { ...utils, railRef };
}

describe("DayTimeline", () => {
  it("places timed task chips at their hour offset", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed]);

    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    const chip = screen.getByTestId("chip-t");
    expect(chip.style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`); // 09:30 = 570min
    // focused chips must paint above later siblings so an expanded editor stays usable
    expect(chip.className).toContain("focus-within:z-30");
    expect(screen.getByText("dentist")).toBeTruthy();
  });

  it("shows the now line only on today, at the current time", async () => {
    const { unmount } = renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("now-line")).toBeTruthy());
    const nowTop = (14 * 60 + 5) * (HOUR_HEIGHT / 60);
    expect(screen.getByTestId("now-line").style.top).toBe(`${nowTop}px`);
    unmount();

    renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByTestId("now-line")).toBeNull();
  });

  it("on today, centers the rail scroll on the current time within a 12h viewport", async () => {
    const { railRef } = renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    // system time is 14:05 -> now offset = 845min * (48/60) = 676px
    // viewport is 12h = 576px, so centered scrollTop = 676 - 288 = 388
    expect(railRef.current?.scrollTop).toBe(388);
  });

  it("on a non-today date, falls back to a 07:00 scroll start", async () => {
    const { railRef } = renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(railRef.current?.scrollTop).toBe(7 * HOUR_HEIGHT);
  });

  it("calls onSelectTask instead of expanding inline, for a rail chip", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const onSelectTask = vi.fn();
    renderTimeline(day, [timed], onSelectTask);
    await waitFor(() => expect(screen.getByText("dentist")).toBeTruthy());

    fireEvent.click(screen.getByText("dentist"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
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

  it("shows the drag preview line on the rail when dragState has a previewTime", async () => {
    const railRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(
      <TasksProvider repository={fakeRepository()}>
        <DayTimeline
          date={todayKey()}
          railRef={railRef}
          getDragHandlers={noopGetDragHandlers}
          dragState={{ id: "x", title: "dragging", pointerX: 0, pointerY: 0, previewTime: "09:30" }}
        />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("drag-preview-line")).toBeTruthy());
    expect(screen.getByTestId("drag-preview-line").style.top).toBe(
      `${(570 * HOUR_HEIGHT) / 60}px`,
    );
  });

  it("shows no drag preview line when dragState is null", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — the current `DayTimeline` doesn't accept `railRef`/`getDragHandlers`/`dragState` props (it creates its own internally), so this won't compile/render as written against the old implementation.

- [ ] **Step 3: Implement — replace the entire contents of `day-timeline.tsx`**

```tsx
"use client";

import { useEffect } from "react";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { TaskItem, taskItemHandlers } from "./task-item";
import type { DragState } from "./use-drag-to-schedule";

export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const VIEWPORT_HOURS = 12; // hours visible in the rail's scroll viewport at once
const VIEWPORT_HEIGHT = VIEWPORT_HOURS * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // fallback start for non-today dates

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

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

export function DayTimeline({
  date,
  onSelectTask,
  railRef,
  getDragHandlers,
  dragState,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  railRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
  dragState: DragState | null;
}) {
  const actions = useTasks();
  const { tasks } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const timed = tasks.filter((t) => scopeKey(t.scope) === key && t.time).sort(compareTasksForDay);
  const isToday = date === todayKey();

  useEffect(() => {
    const railEl = railRef.current;
    if (!railEl) return;
    const viewportHeight = railEl.clientHeight || VIEWPORT_HEIGHT;
    if (isToday) {
      const target = toOffset(nowTime()) - viewportHeight / 2;
      railEl.scrollTop = Math.min(Math.max(target, 0), RAIL_HEIGHT - viewportHeight);
    } else {
      railEl.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date, isToday, railRef]);

  return (
    <div
      ref={railRef}
      data-testid="hour-rail"
      className="relative h-full overflow-y-auto rounded-md border border-border/60"
    >
      <div className="relative" style={{ height: RAIL_HEIGHT }}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            key={hour}
            className="absolute inset-x-0 border-t border-border/15"
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
            className="absolute z-20 touch-none rounded-md bg-brand/10 px-1 ring-1 ring-brand/30 focus-within:z-30"
            style={{
              top: toOffset(t.time!),
              left: `calc(${(column / columns) * 100}% + 2px)`,
              width: `calc(${100 / columns}% - 4px)`,
            }}
            {...getDragHandlers(t.id, t.title)}
          >
            <ul>
              <TaskItem
                task={t}
                {...taskItemHandlers(t.id, actions)}
                onSelect={onSelectTask && (() => onSelectTask(t.id))}
              />
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
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full suite to check for expected breakage**

Run: `cd frontend && npx vitest run`
Expected: `daily-view.test.tsx` now fails (it still renders the old `DailyView`, which calls `<DayTimeline date={anchor} onSelectTask={...} />` without the new required props) — this is expected and fixed in Task 4. Confirm `day-timeline.test.tsx`, `primitives.test.tsx`, and every other file besides `daily-view.test.tsx` are green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "refactor: strip DayTimeline down to just the hour-rail"
```

---

### Task 3: New `DayAgenda` component

**Files:**
- Create: `frontend/src/features/tasks/components/day-agenda.tsx`
- Test: `frontend/src/features/tasks/components/day-agenda.test.tsx`

**Interfaces:**
- Consumes: `TaskItem`'s `size="large"` (Task 1); `compareTasksForDay` from `../lib/times` (existing); `taskItemHandlers` from `./task-item` (existing).
- Produces: `DayAgenda({ date, onSelectTask, agendaZoneRef, getDragHandlers })` — renders every task scoped to `date` (timed + untimed), sorted via `compareTasksForDay` (timed ascending by time, untimed after), each as a `size="large"` `TaskItem` wrapped in a `data-testid="agenda-<id>"` drag-handler div, under a `data-testid="day-agenda"` container (the ref target for the "drop here to clear time" zone), with a `QuickAdd` pinned at the bottom that adds a new task scoped to `{ kind: "day", date }`. `agendaZoneRef: React.RefObject<HTMLDivElement | null>` and `getDragHandlers` are the same shapes Task 2 introduced for `DayTimeline`. Consumed by Task 4 (`DailyView`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/day-agenda.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgenda } from "./day-agenda";

const noopGetDragHandlers = () => ({
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onClickCapture: () => {},
});

function renderAgenda(
  date: string,
  tasks = [] as Parameters<typeof fakeRepository>[0],
  onSelectTask?: (id: string) => void,
) {
  const agendaZoneRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayAgenda
        date={date}
        onSelectTask={onSelectTask}
        agendaZoneRef={agendaZoneRef}
        getDragHandlers={noopGetDragHandlers}
      />
    </TasksProvider>,
  );
}

describe("DayAgenda", () => {
  it("shows the 'All day' label and a quick-add pinned at the bottom", async () => {
    renderAgenda("2026-07-16");
    await waitFor(() => expect(screen.getByText("All day")).toBeTruthy());
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });

  it("lists timed tasks in time order, untimed tasks after", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: "2026-07-16" } });
    const later = makeTask({ id: "l", title: "later", time: "14:00", scope: { kind: "day", date: "2026-07-16" } });
    const earlier = makeTask({ id: "e", title: "earlier", time: "09:00", scope: { kind: "day", date: "2026-07-16" } });
    renderAgenda("2026-07-16", [untimed, later, earlier]);
    await waitFor(() => expect(screen.getByText("earlier")).toBeTruthy());
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("earlier");
    expect(items[1]).toContain("later");
    expect(items[2]).toContain("untimed");
  });

  it("excludes tasks from a different day", async () => {
    const other = makeTask({ id: "o", title: "other day", scope: { kind: "day", date: "2026-07-17" } });
    renderAgenda("2026-07-16", [other]);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("other day")).toBeNull();
  });

  it("renders each task as a large-size card", async () => {
    const t = makeTask({ id: "t", title: "big card", scope: { kind: "day", date: "2026-07-16" } });
    renderAgenda("2026-07-16", [t]);
    await waitFor(() => expect(screen.getByText("big card")).toBeTruthy());
    expect(screen.getByRole("button", { name: "big card" }).className).toContain("text-2xl");
  });

  it("calls onSelectTask instead of expanding inline when a card's title is clicked", async () => {
    const t = makeTask({ id: "t", title: "select me", scope: { kind: "day", date: "2026-07-16" } });
    const onSelectTask = vi.fn();
    renderAgenda("2026-07-16", [t], onSelectTask);
    await waitFor(() => expect(screen.getByText("select me")).toBeTruthy());
    fireEvent.click(screen.getByText("select me"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });

  it("adds a day-scoped task via the bottom quick-add", async () => {
    renderAgenda("2026-07-16");
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "new task" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("new task")).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: FAIL — `./day-agenda` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/features/tasks/components/day-agenda.tsx`:

```tsx
"use client";

import { compareTasksForDay } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
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

export function DayAgenda({
  date,
  onSelectTask,
  agendaZoneRef,
  getDragHandlers,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  agendaZoneRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = [...tasks.filter((t) => scopeKey(t.scope) === key)].sort(compareTasksForDay);

  return (
    <div ref={agendaZoneRef} data-testid="day-agenda" className="flex h-full flex-col">
      <div className="mb-1 shrink-0 text-xs font-semibold">All day</div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {dayTasks.map((t) => (
          <div
            key={t.id}
            data-testid={`agenda-${t.id}`}
            className="touch-none"
            {...getDragHandlers(t.id, t.title)}
          >
            <ul>
              <TaskItem
                task={t}
                size="large"
                {...taskItemHandlers(t.id, actions)}
                onSelect={onSelectTask && (() => onSelectTask(t.id))}
              />
            </ul>
          </div>
        ))}
      </div>
      <QuickAdd onAdd={(title) => addTask(title, scope)} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-agenda.test.tsx
git commit -m "feat: add DayAgenda, a big-card list of a day's full task set"
```

---

### Task 4: Rewrite `DailyView` — wire the lifted drag hook, both children, migrate drag tests

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx`
- Test: `frontend/src/features/tasks/components/views/daily-view.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `DayTimeline`'s new props (Task 2); `DayAgenda` (Task 3); `useDragToSchedule` from `../use-drag-to-schedule` (unchanged, just called from a new location).
- Produces: `DailyView` owns `railRef`/`agendaZoneRef` and the single `useDragToSchedule` call, renders `DayTimeline` (left) and `DayAgenda` (right, swapping with `TaskDetailPanel` via the existing `ShrinkStack` exactly as before), and renders the drag-ghost overlay once at its own top level. The old `weeklyList`/`ScopeTasks` week-rollup is removed entirely.

- [ ] **Step 1: Write the failing tests (full file rewrite)**

Replace the entire contents of `frontend/src/features/tasks/components/views/daily-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { HOUR_HEIGHT } from "../day-timeline";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
});
afterAll(() => {
  vi.useRealTimers();
});

function renderView(onAnchorChange = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

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

describe("DailyView v3 (single-day layout)", () => {
  it("renders no neighboring-day cells", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the timeline and the All day agenda side by side, one quick-add total", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });

  it("shows a timed task both as a rail chip and as an agenda card", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("agenda-t")).toBeTruthy();
    expect(screen.getAllByText("dentist")).toHaveLength(2);
  });

  it("lists an untimed task only in the agenda, not on the rail", async () => {
    const untimed = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());
    expect(screen.queryByTestId("chip-u")).toBeNull();
  });
});

describe("DailyView task detail panel", () => {
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("day-agenda")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // agenda only (untimed, no rail chip)

    const agenda = screen.getByTestId("day-agenda");
    fireEvent.click(within(agenda).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getAllByText("task a")).toHaveLength(2); // agenda row + panel header

    fireEvent.click(within(agenda).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the panel when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("day-agenda")).toBeTruthy());

    const agenda = screen.getByTestId("day-agenda");
    fireEvent.click(within(agenda).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(within(agenda).getByText("task a"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the panel", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("day-agenda")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("renders the detail panel before the agenda list in document order", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("day-agenda")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    const panelPane = screen.getAllByTestId("shrink-stack-secondary")[0];
    const listPane = screen.getAllByTestId("shrink-stack-primary")[0];
    expect(
      panelPane.compareDocumentPosition(listPane) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("DailyView drag-to-schedule (cross-column)", () => {
  it("dragging an agenda card onto the rail sets its time", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const source = screen.getByTestId("agenda-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 }); // -> 09:30
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });

    await waitFor(() => expect(screen.getByTestId("chip-u")).toBeTruthy());
    expect(screen.getByTestId("chip-u").style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`);
  });

  it("dragging a rail chip onto the agenda list clears its time", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 450, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 450, clientY: 50 });

    await waitFor(() => expect(screen.queryByTestId("chip-t")).toBeNull());
    expect(screen.getByTestId("agenda-t")).toBeTruthy();
  });

  it("dragging a rail chip to a new rail position reschedules it (rail-to-rail)", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:00", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 148 }); // rail-relative y=48 -> 09:00
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 772 }); // rail-relative y=672 -> 14:00
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 772 });

    await waitFor(() =>
      expect(screen.getByTestId("chip-t").style.top).toBe(`${(14 * 60 * HOUR_HEIGHT) / 60}px`),
    );
  });

  it("dragging inside the expanded editor's memo textarea does not reschedule the task", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const originalTop = screen.getByTestId("chip-t").style.top;

    fireEvent.click(within(screen.getByTestId("hour-rail")).getByRole("button", { name: "dentist" }));
    const memo = await screen.findByPlaceholderText("Memo");

    fireEvent.pointerDown(memo, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(memo, { pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerUp(memo, { pointerId: 1, clientX: 10, clientY: 50 });

    expect(screen.getByTestId("chip-t").style.top).toBe(originalTop);
  });

  it("shows a ghost while dragging and hides it after drop", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const source = screen.getByTestId("agenda-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 });

    expect(screen.getByTestId("drag-ghost").textContent).toBe("untimed");
    expect(screen.getByTestId("drag-preview-line").textContent).toBe("09:30");

    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});
```

Note: clicking "dentist" in the "does not reschedule" test above opens the `TaskDetailPanel` (since `DailyView` always wires `onSelectTask`), not an inline expansion — the panel's own `TaskDetailFields` renders the same `placeholder="Memo"` textarea (with `showTime={false}`), so `screen.findByPlaceholderText("Memo")` still resolves correctly; the assertion under test (dragging inside a textarea doesn't reschedule) is unaffected by which surface the textarea came from, since `use-drag-to-schedule.ts`'s `onPointerDown` ignores any pointer starting inside `input, textarea` regardless of location.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — the current `DailyView` still renders the old "Weekly" list, calls `DayTimeline` without the new required props, and has no `day-agenda`/`agenda-*` testids.

- [ ] **Step 3: Implement — replace the entire contents of `daily-view.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";

import { ShrinkStack } from "@/components/shrink-stack";

import { useTasks } from "../../store";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { TaskDetailPanel } from "../task-detail-panel";
import { taskItemHandlers } from "../task-item";
import { useDragToSchedule } from "../use-drag-to-schedule";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks, setTime } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));

  const railRef = useRef<HTMLDivElement>(null);
  const agendaZoneRef = useRef<HTMLDivElement>(null);
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef: agendaZoneRef,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
  });

  const agenda = (
    <DayAgenda
      date={anchor}
      onSelectTask={handleSelectTask}
      agendaZoneRef={agendaZoneRef}
      getDragHandlers={getDragHandlers}
    />
  );

  return (
    <>
      <div className="grid h-full grid-cols-2 gap-1.5">
        <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
          <DayTimeline
            date={anchor}
            onSelectTask={handleSelectTask}
            railRef={railRef}
            getDragHandlers={getDragHandlers}
            dragState={dragState}
          />
        </div>
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
          {selectedTask ? (
            <ShrinkStack
              primary={agenda}
              primaryMinHeight={200}
              secondaryFirst
              secondary={
                <TaskDetailPanel
                  task={selectedTask}
                  onClose={() => setSelectedTaskId(null)}
                  {...taskItemHandlers(selectedTask.id, actions)}
                />
              }
            />
          ) : (
            agenda
          )}
        </div>
      </div>

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: dragState.pointerX + 12,
          }}
        >
          {dragState.title}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full test suite**

Run: `cd frontend && npx vitest run`
Expected: every test file green except the one already-known, already-acknowledged pre-existing flaky test in `primitives.test.tsx` ("excludes a day-scoped task dated excludeDate" — a date-dependent issue unrelated to this branch, confirmed on multiple prior occasions to fail identically on commits before any of this work began). If you see ANY other failure, stop and report it — do not guess at additional fixes.

- [ ] **Step 6: Lint and typecheck**

Run: `cd frontend && npm run lint`
Expected: no errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.tsx frontend/src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: rework DailyView around DayAgenda and cross-column drag-to-schedule"
```

---

## Manual verification (after all tasks)

Run `cd frontend && npm run dev`, open the app on the Daily tab, and check:

1. Left column shows only the timeline — no "All-day" zone or quick-add above it.
2. Right column is labeled "All day" and lists every task for the day (timed and untimed) in time order, untimed last, one quick-add at the bottom.
3. Each agenda card is visibly bigger/card-styled compared to before, title text noticeably larger.
4. A timed task appears both as a chip on the timeline and as a card in the agenda.
5. Dragging an untimed agenda card onto the timeline gives it a time (it now also appears as a rail chip).
6. Dragging a timed rail chip onto the agenda list clears its time (chip disappears, card stays in the agenda, now untimed).
7. Clicking an agenda card opens the detail panel; clicking again closes it.
8. The Weekly tab (from the prior feature) still shows this day's tasks correctly in its own day box — unaffected by this change.
