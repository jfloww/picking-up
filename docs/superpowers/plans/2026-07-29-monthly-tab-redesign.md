# Monthly Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Monthly tab's current "reused Yearly view" with a real calendar-month grid, a day-agenda overlay, and re-enable the tab.

**Architecture:** Four tasks. Task 1 adds the date/stats utilities the grid and summary bar need. Task 2 builds the `MonthGrid` component (cells, gutter, status dots). Task 3 builds the new `DayAgendaDrawer` overlay. Task 4 rewires `MonthlyView` to use both, owns the day/task navigation-stack state, adds the "This Month" summary bar, and re-enables the tab in the switcher.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest + Testing Library.

## Global Constraints

- Yearly view (`year-grid.tsx`) is untouched — it keeps using its own component as-is; only Monthly changes.
- Out-of-month leading/trailing cells show real adjacent-month dates (muted), not blank cells.
- Rows fill available height but never shrink below `min-h-24` (6rem) each; the containing view scrolls (not the page — this app's shell doesn't scroll at the page level, so `MonthlyView`'s own root becomes the scrollable region) rather than compressing rows further.
- Today gets a small filled brand-colored pill around the date number only. The selected date (whichever day's agenda drawer is open, including indirectly via an open task reached from it) gets a subtle brand tint + ring on the whole cell — a separate, simultaneous-compatible treatment from today's pill.
- Task previews are text-first: up to 2 active (undone) task titles per cell, each with a small status dot/icon, never a full tinted row background. Completed tasks are represented only in the day's `done/total` count, never as a title line.
- Single click on a day cell selects it and opens the day-agenda drawer. Double-click drills to Daily (`onDrillDown?.("daily", date)`) as a secondary shortcut, not the primary path.
- The week-gutter shows a `"W<n> ›"` label (real text, not a bare icon) that drills to Weekly (`onDrillDown?.("weekly", date)`) when clicked.
- The day-agenda drawer and the existing `TaskDetailDrawer` are one overlay layer at a time (a navigation stack), never both visible simultaneously. Closing the task drawer returns to the day-agenda drawer for the day it was opened from; closing the day-agenda drawer returns to the plain grid.
- The day-agenda drawer is `fixed inset-0` (full-screen) by default and becomes a right-anchored `sm:w-[400px]` panel at the `sm` breakpoint and up — one component, responsive classes, no separate mobile/desktop components.
- No drag-to-reschedule anywhere in the Monthly grid.
- No new npm dependencies.

---

### Task 1: Date and stats utilities for the month grid

**Files:**
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Modify: `frontend/src/features/tasks/lib/dates.test.ts`
- Modify: `frontend/src/features/tasks/lib/times.ts`
- Modify: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks in this plan.
- Produces: `monthGrid(monthKey: string): string[][]` (existing function, changed return type from `(string | null)[][]` to `string[][]` — every cell is now a real date), `weekOfYear(dateKey: string): number` (new), `monthStats(tasks: Task[], monthKey: string): WeekStats` (new, reusing the existing `WeekStats` interface shape `{ total, done }`) — Task 2 consumes `monthGrid`/`weekOfYear`, Task 4 consumes `monthStats`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/lib/dates.test.ts`, replace the existing `monthGrid` test:

```ts
  it("monthGrid builds Su-Sa rows with null padding", () => {
    const grid = monthGrid("2026-07"); // 2026-07-01 is a Wednesday
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      null,
      null,
      null,
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(grid[2][0]).toBe("2026-07-12");
    expect(grid[4]).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      null,
    ]);
    for (const row of grid) expect(row).toHaveLength(7);
  });
```

with:

```ts
  it("monthGrid builds Su-Sa rows with real adjacent-month dates, no nulls", () => {
    const grid = monthGrid("2026-07"); // 2026-07-01 is a Wednesday
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(grid[2][0]).toBe("2026-07-12");
    expect(grid[4]).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it("weekOfYear returns 1 for the week containing January 1st, incrementing each week after", () => {
    // 2026-01-01 is a Thursday, so its Sunday-start week begins 2025-12-28.
    expect(weekOfYear("2026-01-01")).toBe(1);
    expect(weekOfYear("2025-12-28")).toBe(1);
    expect(weekOfYear("2026-01-04")).toBe(2); // the following Sunday's week
    expect(weekOfYear("2026-01-11")).toBe(3);
  });
```

Add `weekOfYear` to the existing `import { ... } from "./dates"` block at the top of the file (alongside `monthGrid`, etc.).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: FAIL — `monthGrid`'s test now expects real dates where the current implementation returns `null`; `weekOfYear` doesn't exist yet.

- [ ] **Step 3: Update `monthGrid` and add `weekOfYear` in `dates.ts`**

Replace the existing `monthGrid` function:

```ts
export function monthGrid(monthKey: string): (string | null)[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = Array(new Date(y, m - 1, 1).getDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    row.push(toKey(new Date(y, m - 1, day)));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    rows.push([...row, ...Array(7 - row.length).fill(null)]);
  }
  return rows;
}
```

with:

```ts
export function monthGrid(monthKey: string): string[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const firstCell = addDays(`${monthKey}-01`, -firstWeekday);
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const rows: string[][] = [];
  for (let i = 0; i < totalCells; i += 7) {
    rows.push(Array.from({ length: 7 }, (_, j) => addDays(firstCell, i + j)));
  }
  return rows;
}
```

Then add, after `monthGrid`:

```ts
// A simple sequential count of Sunday-starting weeks since January 1st of
// dateKey's year — not strict ISO 8601 week numbering (which starts weeks
// on Monday and has its own year-boundary rules this app doesn't otherwise
// follow), matching this app's existing Sunday-start convention.
export function weekOfYear(dateKey: string): number {
  const jan1WeekStart = weekStartOf(`${yearOf(dateKey)}-01-01`);
  return Math.floor(daysBetween(jan1WeekStart, weekStartOf(dateKey)) / 7) + 1;
}
```

- [ ] **Step 4: Update `dates.test.ts`'s test name and run to verify the dates.ts tests pass**

The test replacement in Step 1 already renamed the test; run:

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: PASS (all tests, including the rewritten `monthGrid` test and the new `weekOfYear` test).

- [ ] **Step 5: Write the failing test for `monthStats`**

In `frontend/src/features/tasks/lib/times.test.ts`, add this `describe` block after the existing `describe("weekStats", ...)` block:

```ts
describe("monthStats", () => {
  const monthKey = "2026-07";

  it("counts day-scoped tasks within the month and week-scoped rollover tasks whose rolledFrom date is within it", () => {
    const dayTask = task({ scope: { kind: "day", date: "2026-07-14" } });
    const rolled = task({
      scope: { kind: "week", weekStart: "2026-07-12" },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    const outside = task({ scope: { kind: "day", date: "2026-08-02" } });
    const result = monthStats([dayTask, rolled, outside], monthKey);
    expect(result).toEqual({ done: 0, total: 2 });
  });

  it("counts done tasks separately from total", () => {
    const done = task({ scope: { kind: "day", date: "2026-07-14" }, done: true });
    const undone = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    expect(monthStats([done, undone], monthKey)).toEqual({ done: 1, total: 2 });
  });

  it("does not count a task from an adjacent month even if it appears in the grid's padding", () => {
    const juneTask = task({ scope: { kind: "day", date: "2026-06-28" } });
    const augustTask = task({ scope: { kind: "day", date: "2026-08-01" } });
    expect(monthStats([juneTask, augustTask], monthKey)).toEqual({ done: 0, total: 0 });
  });
});
```

Add `monthStats` to the existing `import { ... } from "./times"` block at the top of the file.

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: FAIL — `monthStats` doesn't exist yet.

- [ ] **Step 7: Add `monthStats` to `times.ts`**

Add this function after the existing `weekStats` function:

```ts
export function monthStats(tasks: Task[], monthKey: string): WeekStats {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let total = 0;
  let done = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    for (const t of dayTasksForWeek(tasks, date, weekStartOf(date))) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  return { total, done };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts src/features/tasks/lib/dates.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/tasks/lib/dates.ts frontend/src/features/tasks/lib/dates.test.ts frontend/src/features/tasks/lib/times.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: add monthGrid real-date padding, weekOfYear, and monthStats utilities"
```

---

### Task 2: `MonthGrid` component

**Files:**
- Create: `frontend/src/features/tasks/components/views/month-grid.tsx`
- Test: `frontend/src/features/tasks/components/views/month-grid.test.tsx`

**Interfaces:**
- Consumes: `monthGrid`, `weekOfYear` from Task 1 (`../../lib/dates`); `dayTasksForWeek`, `compareTasksForDay` (existing, from `../../lib/times`); `useTasks` (existing store).
- Produces: `MonthGrid({ monthKey: string; selectedDate: string | null; onSelectDate: (date: string) => void; onDrillDown?: (view: ViewKind, dateKey: string) => void }): JSX.Element` — Task 4 renders this directly inside `MonthlyView`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/tasks/components/views/month-grid.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { MonthGrid } from "./month-grid";

function renderGrid({
  monthKey = "2026-07",
  selectedDate = null as string | null,
  onSelectDate = vi.fn(),
  onDrillDown = vi.fn(),
  tasks = [] as Parameters<typeof fakeRepository>[0],
} = {}) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <MonthGrid
        monthKey={monthKey}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onDrillDown={onDrillDown}
      />
    </TasksProvider>,
  );
  return { onSelectDate, onDrillDown };
}

describe("MonthGrid", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, a Thursday, within July
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders 5 rows of 7 real dates each for July 2026, including muted out-of-month days", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-01")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-06-28")).toBeTruthy(); // leading, out of month
    expect(screen.getByLabelText("Open 2026-08-01")).toBeTruthy(); // trailing, out of month
    expect(screen.getByLabelText("Open 2026-06-28").className).toContain("opacity-50");
    expect(screen.getByLabelText("Open 2026-07-16").className).not.toContain("opacity-50");
  });

  it("shows a week-of-year gutter label per row that drills to Weekly on click", async () => {
    const { onDrillDown } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-01")).toBeTruthy());
    const gutter = screen.getByLabelText("Open week of 2026-06-28 in Weekly");
    expect(gutter.textContent).toContain("›");
    fireEvent.click(gutter);
    expect(onDrillDown).toHaveBeenCalledWith("weekly", "2026-06-28");
  });

  it("clicking a day cell selects it", async () => {
    const { onSelectDate } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-14");
  });

  it("double-clicking a day cell drills down to Daily", async () => {
    const { onDrillDown } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Open 2026-07-14"));
    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });

  it("shows a brand pill styling on today's date number, not on other dates", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-16")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-07-16").querySelector(".bg-brand")).toBeTruthy();
    expect(screen.getByLabelText("Open 2026-07-14").querySelector(".bg-brand")).toBeNull();
  });

  it("tints and rings the selected date's cell", async () => {
    renderGrid({ selectedDate: "2026-07-14" });
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-07-14").className).toContain("ring-brand");
    expect(screen.getByLabelText("Open 2026-07-16").className).not.toContain("ring-brand");
  });

  it("shows up to 2 active task titles, a done/total count, and a +N more overflow line", async () => {
    const tasks = [
      makeTask({ id: "a", title: "first", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({ id: "b", title: "second", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({ id: "c", title: "third", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({
        id: "d",
        title: "done one",
        done: true,
        scope: { kind: "day", date: "2026-07-14" },
      }),
    ];
    renderGrid({ tasks });
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.queryByText("third")).toBeNull(); // 3rd active title folds into overflow
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy(); // 1 done of 4 total, done not shown as a title
    expect(screen.queryByText("done one")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/month-grid.test.tsx`
Expected: FAIL — `month-grid.tsx` doesn't exist yet.

- [ ] **Step 3: Create `month-grid.tsx`**

```tsx
"use client";

import { RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayOfMonth, monthGrid, monthKeyOf, todayKey, weekOfYear, weekStartOf } from "../../lib/dates";
import { compareTasksForDay, dayTasksForWeek } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";

export function MonthGrid({
  monthKey,
  selectedDate,
  onSelectDate,
  onDrillDown,
}: {
  monthKey: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onDrillDown?: (view: ViewKind, dateKey: string) => void;
}) {
  const { tasks } = useTasks();
  const today = todayKey();
  const rows = monthGrid(monthKey);

  return (
    <div
      data-testid="month-grid"
      className="flex h-full flex-col divide-y divide-border overflow-hidden rounded-md border border-border"
    >
      {rows.map((row) => {
        const gutterDate = row[0];
        return (
          <div
            key={gutterDate}
            className="grid min-h-24 flex-1 divide-x divide-border"
            style={{ gridTemplateColumns: "2.5rem repeat(7, minmax(0, 1fr))" }}
          >
            <button
              type="button"
              onClick={() => onDrillDown?.("weekly", gutterDate)}
              aria-label={`Open week of ${gutterDate} in Weekly`}
              className="flex items-center justify-center text-[10px] font-medium text-subtle transition-colors hover:text-foreground"
            >
              W{weekOfYear(gutterDate)}&nbsp;›
            </button>
            {row.map((date) => {
              const inMonth = monthKeyOf(date) === monthKey;
              const isToday = date === today;
              const isSelected = date === selectedDate;
              const dayTasks = dayTasksForWeek(tasks, date, weekStartOf(date));
              const active = [...dayTasks.filter((t) => !t.done)].sort(compareTasksForDay);
              const shown = active.slice(0, 2);
              const overflow = active.length - shown.length;

              return (
                <div
                  key={date}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDate(date)}
                  onDoubleClick={() => onDrillDown?.("daily", date)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectDate(date);
                    }
                  }}
                  aria-label={`Open ${date}`}
                  className={cn(
                    "flex min-h-0 cursor-pointer flex-col gap-0.5 p-1.5 text-left",
                    !inMonth && "opacity-50",
                    isSelected && "bg-brand/5 ring-1 ring-inset ring-brand",
                  )}
                >
                  <div className="flex shrink-0 items-center justify-between">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        isToday ? "bg-brand text-primary-foreground" : "text-foreground",
                      )}
                    >
                      {dayOfMonth(date)}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="text-[10px] tabular-nums text-subtle">
                        {dayTasks.length - active.length}/{dayTasks.length}
                      </span>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                    {shown.map((t) => {
                      const overdue = date < today;
                      const pending = date === today;
                      const rolled = !!t.repeatSourceId || !!t.rolledFrom;
                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-1 truncate text-[10px] text-foreground"
                        >
                          {overdue ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                          ) : pending ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
                          ) : rolled ? (
                            <RotateCw className="size-2.5 shrink-0 text-subtle" />
                          ) : (
                            <span className="size-1.5 shrink-0 rounded-full bg-subtle/40" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </div>
                      );
                    })}
                    {overflow > 0 && (
                      <div className="text-[10px] text-subtle">+{overflow} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/month-grid.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/views/month-grid.tsx frontend/src/features/tasks/components/views/month-grid.test.tsx
git commit -m "feat: add MonthGrid, a real calendar-month grid for the Monthly tab"
```

---

### Task 3: `DayAgendaDrawer` component

**Files:**
- Create: `frontend/src/features/tasks/components/day-agenda-drawer.tsx`
- Test: `frontend/src/features/tasks/components/day-agenda-drawer.test.tsx`

**Interfaces:**
- Consumes: `ScopeTasks` (existing, `./scope-tasks`), `dayLabel` (existing, `../lib/dates`).
- Produces: `DayAgendaDrawer({ date: string; onClose: () => void; onOpenDaily: () => void; onSelectTask: (id: string) => void }): JSX.Element` — Task 4 renders this from `MonthlyView`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/tasks/components/day-agenda-drawer.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgendaDrawer } from "./day-agenda-drawer";

function renderDrawer({
  date = "2026-07-14",
  onClose = vi.fn(),
  onOpenDaily = vi.fn(),
  onSelectTask = vi.fn(),
  tasks = [] as Parameters<typeof fakeRepository>[0],
} = {}) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayAgendaDrawer
        date={date}
        onClose={onClose}
        onOpenDaily={onOpenDaily}
        onSelectTask={onSelectTask}
      />
    </TasksProvider>,
  );
  return { onClose, onOpenDaily, onSelectTask };
}

describe("DayAgendaDrawer", () => {
  it("shows the date's full task list via ScopeTasks", async () => {
    const t = makeTask({ title: "write plan", scope: { kind: "day", date: "2026-07-14" } });
    renderDrawer({ tasks: [t] });
    await waitFor(() => expect(screen.getByText("write plan")).toBeTruthy());
  });

  it("has a readable date heading", () => {
    renderDrawer({ date: "2026-07-14" });
    expect(screen.getByLabelText(/Tasks for/)).toBeTruthy();
  });

  it("Open Daily calls onOpenDaily", async () => {
    const { onOpenDaily } = renderDrawer();
    await waitFor(() => expect(screen.getByText("Open Daily")).toBeTruthy());
    fireEvent.click(screen.getByText("Open Daily"));
    expect(onOpenDaily).toHaveBeenCalledOnce();
  });

  it("the close button calls onClose", async () => {
    const { onClose } = renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Close day")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Close day"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose", async () => {
    const { onClose } = renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Close day")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("selecting a task inside the list calls onSelectTask with its id", async () => {
    const t = makeTask({ id: "a", title: "write plan", scope: { kind: "day", date: "2026-07-14" } });
    const { onSelectTask } = renderDrawer({ tasks: [t] });
    await waitFor(() => expect(screen.getByText("write plan")).toBeTruthy());
    fireEvent.click(screen.getByText("write plan"));
    expect(onSelectTask).toHaveBeenCalledWith("a");
  });

  it("is full-screen by default and becomes a right-anchored panel at sm and up", () => {
    renderDrawer();
    const drawer = screen.getByTestId("day-agenda-drawer");
    expect(drawer.className).toContain("inset-0");
    expect(drawer.className).toContain("sm:right-0");
    expect(drawer.className).toContain("sm:w-[400px]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda-drawer.test.tsx`
Expected: FAIL — `day-agenda-drawer.tsx` doesn't exist yet.

- [ ] **Step 3: Create `day-agenda-drawer.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayLabel } from "../lib/dates";
import { ScopeTasks } from "./scope-tasks";

export function DayAgendaDrawer({
  date,
  onClose,
  onOpenDaily,
  onSelectTask,
}: {
  date: string;
  onClose: () => void;
  onOpenDaily: () => void;
  onSelectTask: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      data-testid="day-agenda-drawer"
      aria-label={`Tasks for ${dayLabel(date)}`}
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-card shadow-2xl transition-transform duration-200 ease-out",
        "sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[400px] sm:border-l sm:border-border",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-6">
        <span className="min-w-0 truncate text-[15px] font-semibold">{dayLabel(date)}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenDaily}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            Open Daily
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <ScopeTasks scope={{ kind: "day", date }} quickAdd onSelectTask={onSelectTask} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda-drawer.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/day-agenda-drawer.tsx frontend/src/features/tasks/components/day-agenda-drawer.test.tsx
git commit -m "feat: add DayAgendaDrawer, a day's full task list as a responsive overlay"
```

---

### Task 4: Wire `MonthlyView` and re-enable the tab

**Files:**
- Modify: `frontend/src/features/tasks/components/views/monthly-view.tsx`
- Create: `frontend/src/features/tasks/components/views/monthly-view.test.tsx`
- Modify: `frontend/src/features/tasks/components/view-switcher.tsx`

**Interfaces:**
- Consumes: `MonthGrid` from Task 2, `DayAgendaDrawer` from Task 3, `monthStats` from Task 1, `TaskDetailDrawer`/`taskItemHandlers` (existing).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/views/monthly-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { MonthlyView } from "./monthly-view";

const ANCHOR = "2026-07-16"; // within July 2026

function renderView(onDrillDown = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <MonthlyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={onDrillDown} />
    </TasksProvider>,
  );
  return onDrillDown;
}

describe("MonthlyView", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("shows the This Month summary with a done/total count", async () => {
    const a = makeTask({ title: "a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("This Month")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("renders the month grid", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("month-grid")).toBeTruthy());
  });

  it("clicking a day cell opens the day-agenda drawer for that date, no task-detail drawer yet", async () => {
    renderView();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    await waitFor(() => expect(screen.getByTestId("day-agenda-drawer")).toBeTruthy());
    expect(screen.queryByTestId("task-detail-drawer")).toBeNull();
  });

  it("selecting a task inside the day-agenda drawer shows only the task-detail drawer (single overlay layer)", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    await waitFor(() => expect(screen.getByText("task a")).toBeTruthy());

    fireEvent.click(screen.getByText("task a"));

    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());
    expect(screen.queryByTestId("day-agenda-drawer")).toBeNull();
  });

  it("closing the task-detail drawer returns to the day-agenda drawer, not to no overlay", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    await waitFor(() => expect(screen.getByText("task a")).toBeTruthy());
    fireEvent.click(screen.getByText("task a"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Close details"));

    await waitFor(() => expect(screen.getByTestId("day-agenda-drawer")).toBeTruthy());
    expect(screen.queryByTestId("task-detail-drawer")).toBeNull();
  });

  it("closing the day-agenda drawer returns to the plain grid", async () => {
    renderView();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    await waitFor(() => expect(screen.getByLabelText("Close day")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Close day"));

    expect(screen.queryByTestId("day-agenda-drawer")).toBeNull();
    expect(screen.queryByTestId("task-detail-drawer")).toBeNull();
  });

  it("the day-agenda drawer's Open Daily button calls onDrillDown('daily', date)", async () => {
    const onDrillDown = renderView();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    await waitFor(() => expect(screen.getByText("Open Daily")).toBeTruthy());

    fireEvent.click(screen.getByText("Open Daily"));

    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/monthly-view.test.tsx`
Expected: FAIL — `MonthlyView` still renders the old `YearGrid`-based content, none of the new testids/text exist.

- [ ] **Step 3: Replace `monthly-view.tsx`'s implementation**

Replace the full contents of `frontend/src/features/tasks/components/views/monthly-view.tsx` with:

```tsx
"use client";

import { useState } from "react";

import { monthKeyOf } from "../../lib/dates";
import { monthStats } from "../../lib/times";
import { useTasks } from "../../store";
import { DayAgendaDrawer } from "../day-agenda-drawer";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { MonthGrid } from "./month-grid";
import type { CalendarViewProps } from "./weekly-view";

type Overlay = { type: "day"; date: string } | { type: "task"; taskId: string; fromDate: string };

export function MonthlyView({ anchor, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const monthKey = monthKeyOf(anchor);
  const { done, total } = monthStats(tasks, monthKey);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const selectedDate =
    overlay?.type === "day" ? overlay.date : overlay?.type === "task" ? overlay.fromDate : null;
  const selectedTask =
    overlay?.type === "task" ? (tasks.find((t) => t.id === overlay.taskId) ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <div className="shrink-0 rounded-md bg-muted/40 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
          This Month
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

      <div className="min-h-0 flex-1">
        <MonthGrid
          monthKey={monthKey}
          selectedDate={selectedDate}
          onSelectDate={(date) => setOverlay({ type: "day", date })}
          onDrillDown={onDrillDown}
        />
      </div>

      {overlay?.type === "day" && (
        <DayAgendaDrawer
          date={overlay.date}
          onClose={() => setOverlay(null)}
          onOpenDaily={() => onDrillDown?.("daily", overlay.date)}
          onSelectTask={(taskId) => setOverlay({ type: "task", taskId, fromDate: overlay.date })}
        />
      )}

      {selectedTask && overlay?.type === "task" && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setOverlay({ type: "day", date: overlay.fromDate })}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/monthly-view.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Re-enable the Monthly tab**

In `frontend/src/features/tasks/components/view-switcher.tsx`, change:

```ts
const VISIBLE_VIEWS: readonly ViewKind[] = ["daily", "weekly"];
```

to:

```ts
const VISIBLE_VIEWS: readonly ViewKind[] = ["daily", "weekly", "monthly"];
```

- [ ] **Step 6: Remove the now-obsolete skipped Monthly test in `task-calendar.test.tsx`**

`frontend/src/features/tasks/components/task-calendar.test.tsx` has an
`it.skip` test left over from when Monthly was hidden, testing the *old*
YearGrid-based interaction (double-clicking a "month cell" button like
`Focus March`) — that interaction no longer exists in the redesigned
day-grid Monthly view (Task 2's `MonthGrid` renders day cells, and its
Weekly drill-down happens via the week-gutter, already covered by
`month-grid.test.tsx`'s "shows a week-of-year gutter label..." test and
`monthly-view.test.tsx`'s "Open Daily" test). Delete the obsolete test and
its explanatory comment entirely — do not un-skip it, its premise is gone:

```tsx
  // Monthly is temporarily hidden from the tab bar (view-switcher.tsx's
  // VISIBLE_VIEWS), so it can't be reached via a tab click right now — the
  // drill-down behavior itself is untouched and still fully implemented;
  // re-enable this test alongside restoring the tab.
  it.skip("double-clicking a Monthly month cell switches to Weekly anchored on that month's first week", async () => {
    render(<TaskCalendar repository={fakeRepository()} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Monthly" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Focus March" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Weekly", selected: true })).toBeTruthy(),
    );
    // 2026-03-01 is a Sunday, so its own week starts on itself.
    expect(screen.getByText("Mar 1 – Mar 7")).toBeTruthy();
  });
```

Remove this whole block (comment + test), leaving the `describe("drill-down
navigation", ...)` block's other test (`"double-clicking a Weekly day date
switches to Daily anchored on that date"`) and the block's closing `});` in
place.

Also update the now-stale comment in the `"shows a date label matching the
current view..."` test (inside `describe("fixed sub-header", ...)`),
currently:

```tsx
      fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
      await waitFor(() => expect(screen.getByText("Jul 12 – Jul 18")).toBeTruthy());
      // Monthly is temporarily hidden from the tab bar (view-switcher.tsx's
      // VISIBLE_VIEWS) — it isn't reachable via a tab click right now, so
      // this test only exercises the tabs that still are.
```

Replace the three-line comment with a single line reflecting reality now
that Monthly is visible again — this test still only exercises Daily and
Weekly, which remains a legitimate, deliberate scope choice, just no longer
because Monthly is hidden:

```tsx
      fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
      await waitFor(() => expect(screen.getByText("Jul 12 – Jul 18")).toBeTruthy());
      // This test only exercises Daily and Weekly; Monthly's own
      // fixed-sub-header behavior is covered separately, in monthly-view.test.tsx.
```

Do not touch the *other* comment in `"defaults to the Daily Focus Planner
view..."` (`describe("TaskCalendar", ...)`, mentions "Yearly is temporarily
hidden") — that one is still accurate, since Yearly stays hidden.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass. Known pre-existing flake: `weekly-view.test.tsx`'s
"shows the hero's done/total count" test intermittently fails only in
full-suite runs, passes on retry — if hit, re-run once; any other failure
is real.

- [ ] **Step 8: Run type-check and lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src --quiet`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/tasks/components/views/monthly-view.tsx frontend/src/features/tasks/components/views/monthly-view.test.tsx frontend/src/features/tasks/components/view-switcher.tsx frontend/src/features/tasks/components/task-calendar.test.tsx
git commit -m "feat: wire the redesigned Monthly view and re-enable its tab"
```
