# Weekly Task Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every "this week's tasks" list (the Daily tab's Weekly Task
column, and the Weekly view's own per-week cell) show unfinished day-scoped
tasks for that week — not just tasks created directly at the week level —
each labeled with its date (and time, if set).

**Architecture:** Two new pure functions do the data work:
`shortDateLabel` (date formatting, `lib/dates.ts`) and `weeklyRollupTasks`
(inclusion + sort, `lib/times.ts`). `TaskItem` gains an optional `dateLabel`
prop. `ScopeTasks` is the single call site that wires them together — when
`scope.kind === "week"` it now calls `weeklyRollupTasks` instead of a plain
scope-key filter; both the Daily tab and Weekly view already render through
`ScopeTasks`, so the change is automatically consistent everywhere.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind CSS 4, Vitest +
Testing Library + jsdom.

## Global Constraints

- No new npm dependencies.
- No changes to `lib/rollover.ts`, the store (`store.tsx`), or the `Task`/`Scope`
  types (`types.ts`) — this feature is read-side query and display only.
- No changes to `use-drag-to-schedule.ts`, `day-timeline.tsx`, or
  `daily-view.tsx`'s layout — only its test file gains one new test (Task 4).
- Test conventions: colocated `*.test.ts`/`*.test.tsx` files, `TasksProvider`
  + `fakeRepository`/`makeTask` from `../test-utils` (or `../../test-utils`
  from a `views/` file). `components/primitives.test.tsx`'s existing
  `ScopeTasks` tests deliberately do NOT pin the clock (they use the real
  `todayKey()`/`weekStartOf()` so `rolloverTasks`, which runs on load, never
  moves fixtures out of the scope under test) — follow that same pattern for
  any new test added to that file. `views/daily-view.test.tsx` and
  `views/weekly-view.test.tsx` DO pin the clock
  (`vi.setSystemTime(new Date(2026, 6, 16, ...))`, Thursday 2026-07-16) —
  follow that pattern there instead.
- Test command: run from `frontend/` — `npx vitest run <path>` for a single
  file, `npm test` for the full suite.
- Commit messages: no `Co-Authored-By` trailer needed on per-task commits.

---

### Task 1: Pure functions — `shortDateLabel` and `weeklyRollupTasks`

**Files:**
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Modify: `frontend/src/features/tasks/lib/dates.test.ts`
- Modify: `frontend/src/features/tasks/lib/times.ts`
- Modify: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Consumes: `Task`, `Scope` types (`../types`, unchanged). `weekStartOf`
  (`lib/dates.ts`, unchanged) is imported into `lib/times.ts` for the first
  time in this task.
- Produces: `shortDateLabel(dateKey: string, today: string): string` (in
  `lib/dates.ts`) — Task 3 calls this with `todayKey()` as `today`.
  `WeeklyRollupItem { task: Task; date: string | null }` and
  `weeklyRollupTasks(tasks: Task[], weekStart: string): WeeklyRollupItem[]`
  (in `lib/times.ts`) — Task 3 calls this for `scope.kind === "week"`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/lib/dates.test.ts` — first add
`shortDateLabel` to the import list (currently ends `weekStartOf, yearOf`):

```ts
  shortDateLabel,
```

(insert alphabetically, i.e. between `nextMonthKey` and `todayKey`... actually
between `prevMonthKey` and `todayKey` — the list is alphabetical, so it goes
right before `todayKey`)

Then append this new `describe` block after the existing `describe("dayLabel", ...)`:

```ts
describe("shortDateLabel", () => {
  it("returns Today when the date matches today", () => {
    expect(shortDateLabel("2026-07-16", "2026-07-16")).toBe("Today");
  });

  it("returns a short weekday/month/day form otherwise", () => {
    expect(shortDateLabel("2026-07-20", "2026-07-16")).toBe("Mon Jul 20");
  });
});
```

Append to `frontend/src/features/tasks/lib/times.test.ts` — first add
`weeklyRollupTasks` to the import list (currently
`import type { Task } from "../types"; import { compareTasksForDay, isValidTime, layoutTimedTasks, nowTime, timeToMinutes, yToSnappedTime } from "./times";`),
inserted alphabetically:

```ts
import { compareTasksForDay, isValidTime, layoutTimedTasks, nowTime, timeToMinutes, weeklyRollupTasks, yToSnappedTime } from "./times";
```

Then append this new `describe` block at the end of the file:

```ts
describe("weeklyRollupTasks", () => {
  const weekStart = "2026-07-12"; // Sunday

  it("includes week-level tasks in the week, excludes tasks from other weeks", () => {
    const inWeek = task({ scope: { kind: "week", weekStart } });
    const otherWeek = task({ scope: { kind: "week", weekStart: "2026-07-19" } });
    const result = weeklyRollupTasks([inWeek, otherWeek], weekStart);
    expect(result.map((r) => r.task.id)).toEqual([inWeek.id]);
  });

  it("includes unfinished day tasks in the week, excludes done ones and tasks outside the week", () => {
    const undone = task({ scope: { kind: "day", date: "2026-07-14" }, done: false });
    const done = task({ scope: { kind: "day", date: "2026-07-15" }, done: true });
    const outside = task({ scope: { kind: "day", date: "2026-07-20" }, done: false }); // next week
    const result = weeklyRollupTasks([undone, done, outside], weekStart);
    expect(result.map((r) => r.task.id)).toEqual([undone.id]);
  });

  it("dates a rolled-over week task from rolledFrom.date, and a genuine week task as null", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    const genuine = task({ scope: { kind: "week", weekStart } });
    const result = weeklyRollupTasks([genuine, rolled], weekStart);
    expect(result.find((r) => r.task.id === rolled.id)?.date).toBe("2026-07-13");
    expect(result.find((r) => r.task.id === genuine.id)?.date).toBeNull();
  });

  it("sorts by date then time, dateless tasks last", () => {
    const later = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    const earlierTimed = task({
      scope: { kind: "day", date: "2026-07-14" },
      time: "09:00",
      done: false,
    });
    const earlierUntimed = task({ scope: { kind: "day", date: "2026-07-14" }, done: false });
    const dateless = task({ scope: { kind: "week", weekStart } });
    const result = weeklyRollupTasks(
      [later, earlierUntimed, earlierTimed, dateless],
      weekStart,
    );
    expect(result.map((r) => r.task.id)).toEqual([
      earlierTimed.id,
      earlierUntimed.id,
      later.id,
      dateless.id,
    ]);
  });
});
```

Note: `times.test.ts` already has a local `task(overrides)` helper function
(used by the `describe("layoutTimedTasks", ...)` block) — reuse it, don't
declare a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts src/features/tasks/lib/times.test.ts`
Expected: FAIL — `shortDateLabel` and `weeklyRollupTasks` are not exported
from their modules yet (import errors / undefined).

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/features/tasks/lib/dates.ts`:

```ts
export function shortDateLabel(dateKey: string, today: string): string {
  if (dateKey === today) return "Today";
  const d = parse(dateKey);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${month} ${d.getDate()}`;
}
```

(`parse` is the file's existing private helper at the top of `dates.ts` —
reuse it, don't reimplement date parsing.)

At the top of `frontend/src/features/tasks/lib/times.ts`, change the import
line from `import type { Task } from "../types";` to also bring in
`weekStartOf`:

```ts
import type { Task } from "../types";
import { weekStartOf } from "./dates";
```

Then append to `frontend/src/features/tasks/lib/times.ts`:

```ts
export interface WeeklyRollupItem {
  task: Task;
  date: string | null;
}

export function weeklyRollupTasks(tasks: Task[], weekStart: string): WeeklyRollupItem[] {
  const items: WeeklyRollupItem[] = [];

  for (const task of tasks) {
    if (task.scope.kind === "week" && task.scope.weekStart === weekStart) {
      const date = task.rolledFrom?.kind === "day" ? task.rolledFrom.date : null;
      items.push({ task, date });
    } else if (
      task.scope.kind === "day" &&
      !task.done &&
      weekStartOf(task.scope.date) === weekStart
    ) {
      items.push({ task, date: task.scope.date });
    }
  }

  return items.sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return compareTasksForDay(a.task, b.task);
    }
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts src/features/tasks/lib/times.test.ts`
Expected: PASS (all tests in both files, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/dates.ts frontend/src/features/tasks/lib/dates.test.ts frontend/src/features/tasks/lib/times.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: add shortDateLabel and weeklyRollupTasks pure functions"
```

---

### Task 2: `TaskItem` gains an optional `dateLabel` prop

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TaskItem`'s prop type gains `dateLabel?: string`. Task 3's
  `ScopeTasks` passes this prop when rendering week-scope items.

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/components/primitives.test.tsx`, inside the
existing `describe("TaskItem v2", ...)` block, add this test after "edits and
clears the time from the expansion":

```ts
  it("shows an optional date label before the time badge", () => {
    render(
      <TaskItem
        task={makeTask({ title: "dentist", time: "14:00" })}
        {...noopHandlers}
        dateLabel="Mon Jul 20"
      />,
    );
    expect(screen.getByText("Mon Jul 20")).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — TypeScript rejects the unknown `dateLabel` prop (or, if
using a loosely-typed render, the label text is simply absent from the DOM).

- [ ] **Step 3: Write the implementation**

In `frontend/src/features/tasks/components/task-item.tsx`, add `dateLabel`
to both the destructured props and the inline prop type (currently lines
36-54):

```tsx
export function TaskItem({
  task,
  dateLabel,
  onToggle,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  dateLabel?: string;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
```

Then, immediately before the existing `{task.time && (...)}` block (currently
lines 67-71) inside the collapsed row's `<div className="flex items-center gap-2">`, add:

```tsx
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add optional dateLabel prop to TaskItem"
```

---

### Task 3: Wire `ScopeTasks` to the weekly rollup

**Files:**
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `weeklyRollupTasks`, `WeeklyRollupItem` (`../lib/times`, from
  Task 1). `shortDateLabel`, `todayKey` (`../lib/dates`, `shortDateLabel`
  from Task 1, `todayKey` pre-existing). `TaskItem`'s `dateLabel` prop
  (from Task 2).
- Produces: no new exports — `ScopeTasks`'s public props (`scope`,
  `quickAdd`, `compact`) are unchanged; only its internal query and the
  props it passes to child `TaskItem`s change.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, first
update the import from `../lib/dates` (currently
`import { todayKey, weekStartOf } from "../lib/dates";`) to:

```ts
import { addDays, shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
```

Then replace the existing `describe("ScopeTasks", ...)` block (the one
whose `outScope` task currently asserts a day-scoped task is excluded from
a week-scope render — that assertion is exactly the old behavior this task
changes, so it must be replaced, not left as-is) with:

```ts
describe("ScopeTasks", () => {
  it("renders week-level tasks; a day task from a different week is excluded", async () => {
    const week = weekStartOf(todayKey());
    const inScope = makeTask({
      id: "in",
      title: "in scope",
      scope: { kind: "week", weekStart: week },
    });
    const outOfWeek = makeTask({
      id: "out",
      title: "out of scope",
      scope: { kind: "day", date: addDays(week, -1) }, // last day of the prior week
    });
    render(
      <TasksProvider repository={fakeRepository([inScope, outOfWeek])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("in scope")).toBeTruthy());
    expect(screen.queryByText("out of scope")).toBeNull();
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });
});

describe("ScopeTasks weekly rollup", () => {
  it("includes an unfinished day task from the week, with a date label", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("day task")).toBeTruthy());
    expect(screen.getByText(shortDateLabel(future, todayKey()))).toBeTruthy();
  });

  it("excludes a done day task from the week", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const doneTask = makeTask({
      id: "d",
      title: "done task",
      done: true,
      scope: { kind: "day", date: future },
    });
    render(
      <TasksProvider repository={fakeRepository([doneTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("done task")).toBeNull();
  });

  it("includes the day task in compact mode without a date label", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} compact />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText(/day task/)).toBeTruthy());
    expect(screen.queryByText(shortDateLabel(future, todayKey()))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — the new `describe("ScopeTasks weekly rollup", ...)` tests
fail because `ScopeTasks` doesn't yet include day-scoped tasks in a
week-scope render.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of
`frontend/src/features/tasks/components/scope-tasks.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

import { shortDateLabel, todayKey } from "../lib/dates";
import { compareTasksForDay, weeklyRollupTasks } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;

  let items: { task: Task; date: string | null }[];
  if (scope.kind === "week") {
    items = weeklyRollupTasks(tasks, scope.weekStart);
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

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {items.map(({ task: t, date }) => (
          <TaskItem
            key={t.id}
            task={t}
            dateLabel={date ? shortDateLabel(date, today) : undefined}
            {...taskItemHandlers(t.id, actions)}
          />
        ))}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/scope-tasks.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: ScopeTasks includes unfinished day tasks in week-scope renders"
```

---

### Task 4: End-to-end checks in both views

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.test.tsx`
- Modify: `frontend/src/features/tasks/components/views/weekly-view.test.tsx`

**Interfaces:**
- Consumes: `DailyView`, `WeeklyView` (unchanged — this task adds tests
  only, no production code changes). `makeTask` from `../../test-utils`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/views/daily-view.test.tsx`:

1. Add `makeTask` to the test-utils import (currently
   `import { fakeRepository } from "../../test-utils";`):

```ts
import { fakeRepository, makeTask } from "../../test-utils";
```

2. Change the `renderView` helper to accept an optional `tasks` argument
   (currently only takes `onAnchorChange`):

```ts
function renderView(onAnchorChange = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}
```

3. Add this test inside the existing `describe("DailyView v3 (single-day layout)", ...)` block:

```ts
  it("shows an unfinished future-day task from the week in the Weekly Task column, dated", async () => {
    const dayTask = makeTask({
      id: "d",
      title: "day task",
      scope: { kind: "day", date: "2026-07-17" },
    });
    renderView(vi.fn(), [dayTask]);
    await waitFor(() => expect(screen.getByText("day task")).toBeTruthy());
    expect(screen.getByText("Fri Jul 17")).toBeTruthy();
  });
```

In `frontend/src/features/tasks/components/views/weekly-view.test.tsx`, add
this test inside the existing `describe("WeeklyView", ...)` block:

```ts
  it("shows an unfinished day task from the week in the Weekly column, dated", async () => {
    const dayTask = makeTask({
      id: "d",
      title: "weekly-rollup task",
      scope: { kind: "day", date: "2026-07-17" },
    });
    renderView(vi.fn(), [dayTask]);
    await waitFor(() => expect(screen.getByText("Fri Jul 17")).toBeTruthy());
  });
```

(This test uses a title — `"weekly-rollup task"` — that doesn't collide with
any other fixture in the file, and asserts only the date label, which is
unique to the rollup-rendered copy: the task's own July-17 day cell in the
grid also renders "weekly-rollup task", but never with a date label, so
`getByText("Fri Jul 17")` unambiguously proves the Weekly column includes it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx src/features/tasks/components/views/weekly-view.test.tsx`
Expected: FAIL for both new tests — before Tasks 1-3, no `"Fri Jul 17"` text
exists anywhere in either render.

Since this task makes no production code changes, this red state should
already be resolved by the time you run it (Tasks 1-3 are complete
first) — if it's still red after confirming Tasks 1-3 landed, STOP and
report BLOCKED rather than guessing.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx src/features/tasks/components/views/weekly-view.test.tsx`
Expected: PASS (all tests in both files, including the pre-existing ones —
in particular, `daily-view.test.tsx`'s other three tests, which call
`renderView()` with no arguments, must still pass unchanged with the new
default-`tasks` parameter).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.test.tsx frontend/src/features/tasks/components/views/weekly-view.test.tsx
git commit -m "test: verify weekly rollup shows up in both Daily and Weekly views"
```

---

### Task 5: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run (from `frontend/`): `npm test`
Expected: PASS, all files.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no new warnings (pre-existing `primitives.test.tsx` unused-var
warnings, if any remain from before this branch, are not introduced by this
plan and can be ignored).

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS — confirms no type errors from the new `dateLabel` prop, the
`ScopeTasks` rewrite, or the new pure functions.

- [ ] **Step 4: Manual browser verification checklist**

Start the dev server (`npm run dev`) and, on `/app`:

1. In the Daily tab, add a task for a future day this week (via that day's
   own quick-add, or by dragging a chip's time in the Daily tab of that
   day). Confirm it now appears in the Weekly Task column, labeled with its
   date (or "Today" if applicable) and time if set.
2. Mark that task done from wherever it's easiest — confirm it disappears
   from the Weekly Task column (but a genuine week-level task you add
   directly in that column, if any, keeps showing even when done, since
   only day-scoped tasks are filtered by done-state here).
3. Switch to the Weekly view and confirm the same week's "Weekly" cell for
   the focused week shows the same rolled-up set.
4. Confirm a task from a different week does not appear.
5. Confirm the existing non-focused (compact) day and week cells in the
   Weekly view still render tersely (title + time, no date-label clutter).

- [ ] **Step 5: Report status**

If all checks pass, the branch is ready to push. If any manual check fails,
stop and report which one before proceeding — do not attempt an ad hoc fix
outside this plan's task boundaries.
