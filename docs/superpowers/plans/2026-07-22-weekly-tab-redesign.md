# Weekly Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Weekly tab's scrollable month-of-weeks stack with a single week (7 bigger day boxes + one stats/progress hero box), and wire double-click drill-down navigation (Monthly month cell → that week; Weekly day → that day).

**Architecture:** Nine bottom-up tasks: a new theme token, two pure-function additions to `lib/dates.ts`/`lib/times.ts`, two shared-component prop additions (`TaskItem`, `ScopeTasks`), a `PeriodCell` prop addition, `YearGrid`/`MonthlyView` double-click wiring, a full `WeeklyView` rewrite, and finally `task-calendar.tsx`'s navigation/drill-down wiring that ties the views together. Each task is independently testable and ordered so nothing forward-references a type or function defined later.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Vitest + Testing Library. All commands below run from the `frontend/` directory.

## Global Constraints

- No schema changes to `Task` (`frontend/src/features/tasks/types.ts`) — `repeatWeekdays`/`repeatSourceId`/`rolledFrom` already carry everything needed.
- Follow existing conventions exactly: Tailwind utility classes only (no CSS modules), the `cn()` helper for conditional classes, semantic theme tokens (`text-destructive`, `bg-muted`, etc.) rather than raw Tailwind palette colors — this codebase has zero precedent for raw-palette classes like `amber-500`.
- Every new/changed prop is optional with a safe default so existing callers (`DailyView`, `MonthlyView`, `YearlyView` where unrelated) keep working unmodified.
- Test file conventions: fake timers pinned to `2026-07-16` (Thursday) where "today" matters, `fakeRepository`/`makeTask` from `test-utils.tsx`, `TasksProvider` wrapping every render.

---

### Task 1: Add a `warning` theme token

**Files:**
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces: Tailwind utility classes `text-warning`, `bg-warning`, `border-warning` (and opacity variants like `bg-warning/10`), available app-wide, following the exact same pattern as the existing `destructive` token.

- [ ] **Step 1: Add the `--warning` custom property to both themes**

In `frontend/src/app/globals.css`, in the `:root` block, add a line right after `--destructive: #b42318;`:

```css
  --destructive: #b42318;
  --warning: #b45309;
```

In the `.dark` block, add a line right after `--destructive: #ff8a7a;`:

```css
  --destructive: #ff8a7a;
  --warning: #fbbf24;
```

- [ ] **Step 2: Register it in `@theme inline`**

In the `@theme inline` block, add a line right after `--color-destructive: var(--destructive);`:

```css
  --color-destructive: var(--destructive);
  --color-warning: var(--warning);
```

- [ ] **Step 3: Verify the dev build still compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no CSS errors). This is a pure CSS addition — no component references `text-warning`/`border-warning` yet, so no visual change occurs until Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat: add warning theme token for pending-today task highlighting"
```

---

### Task 2: Add `weekRangeLabel` to `lib/dates.ts`

**Files:**
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Test: `frontend/src/features/tasks/lib/dates.test.ts`

**Interfaces:**
- Produces: `weekRangeLabel(weekStart: string): string` — e.g. `weekRangeLabel("2026-07-12")` → `"Jul 12 – Jul 18"`. Consumed by Task 9 (`task-calendar.tsx`'s `dateLabelFor`).
- Consumes: existing `addDays` (exported) and the module-private `parse` helper, both already in this file.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/lib/dates.test.ts`, add this import to the existing import list (alphabetical, matching the file's existing style) and a new `describe` block at the end of the file:

```ts
// add to the existing import block from "./dates":
  weekRangeLabel,
```

```ts
describe("weekRangeLabel", () => {
  it("formats a week within a single month", () => {
    expect(weekRangeLabel("2026-07-12")).toBe("Jul 12 – Jul 18");
  });

  it("formats a week spanning two months", () => {
    expect(weekRangeLabel("2026-06-28")).toBe("Jun 28 – Jul 4");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: FAIL — `weekRangeLabel` is not exported from `./dates`.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/lib/dates.ts`, add this function after `shortDateLabel` (at the end of the file):

```ts
export function weekRangeLabel(weekStart: string): string {
  const start = parse(weekStart);
  const end = parse(addDays(weekStart, 6));
  const fmt = (d: Date) =>
    `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/dates.ts frontend/src/features/tasks/lib/dates.test.ts
git commit -m "feat: add weekRangeLabel for the Weekly tab's header"
```

---

### Task 3: Add repeat-label, week-stats, and rollover-aware day-task helpers to `lib/times.ts`

**Files:**
- Modify: `frontend/src/features/tasks/lib/times.ts`
- Test: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Produces:
  - `repeatCadenceLabel(weekdays: number[]): string` — `"Daily"` for all 7, `"Weekdays"` for exactly Mon–Fri (`[1,2,3,4,5]`), otherwise abbreviated days joined by `/` (e.g. `"Mo/We/Fr"`).
  - `repeatLabelForTask(task: Task, tasks: Task[]): string | undefined` — resolves a task's own `repeatWeekdays`, or (for a generated instance) its anchor's `repeatWeekdays` via `repeatSourceId`; `undefined` if not repeating.
  - `interface WeekStats { done: number; total: number }` and `weekStats(tasks: Task[], weekStart: string): WeekStats` — counts every task "in" a week: day-scoped tasks whose date falls in that week, plus week-scoped tasks (genuine or rolled-over) for that `weekStart`.
  - `dayTasksForWeek(tasks: Task[], date: string, weekStart: string): Task[]` — a day box's full task list: tasks still `scope.kind === "day"` on that date, **plus** week-scoped tasks rolled over from that date (`rolledFrom.kind === "day" && rolledFrom.date === date`) within that week. Consumed by Task 5 (`ScopeTasks`) and Task 7 (`WeeklyView`).
- Consumes: `weekStartOf` (already imported in this file from `./dates`), `Task` type from `../types`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/lib/times.test.ts`, update the import line to include the new functions:

```ts
import {
  compareTasksForDay,
  dayTasksForWeek,
  isValidTime,
  layoutTimedTasks,
  nowTime,
  repeatCadenceLabel,
  repeatLabelForTask,
  timeToMinutes,
  weeklyRollupTasks,
  weekStats,
  yToSnappedTime,
} from "./times";
```

Add these `describe` blocks at the end of the file:

```ts
describe("repeatCadenceLabel", () => {
  it("returns Daily for all 7 weekdays", () => {
    expect(repeatCadenceLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Daily");
  });

  it("returns Weekdays for exactly Mon-Fri", () => {
    expect(repeatCadenceLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
  });

  it("abbreviates a specific, non-standard set of days", () => {
    expect(repeatCadenceLabel([5, 1, 3])).toBe("Mo/We/Fr"); // unsorted input
  });

  it("handles a single day", () => {
    expect(repeatCadenceLabel([0])).toBe("Su");
  });
});

describe("repeatLabelForTask", () => {
  it("labels an anchor task from its own repeatWeekdays", () => {
    const anchor = task({ repeatWeekdays: [1, 2, 3, 4, 5] });
    expect(repeatLabelForTask(anchor, [anchor])).toBe("Weekdays");
  });

  it("labels a generated instance by resolving its anchor via repeatSourceId", () => {
    const anchor = task({ id: "anchor", repeatWeekdays: [0, 6] });
    const instance = task({ id: "inst", repeatSourceId: "anchor" });
    expect(repeatLabelForTask(instance, [anchor, instance])).toBe("Su/Sa");
  });

  it("returns undefined for a non-repeating task", () => {
    const plain = task({});
    expect(repeatLabelForTask(plain, [plain])).toBeUndefined();
  });

  it("returns undefined when the anchor can't be found", () => {
    const orphan = task({ repeatSourceId: "missing" });
    expect(repeatLabelForTask(orphan, [orphan])).toBeUndefined();
  });
});

describe("weekStats", () => {
  const weekStart = "2026-07-12"; // Sunday

  it("counts day-scoped tasks within the week and week-scoped tasks for it", () => {
    const dayTask = task({ scope: { kind: "day", date: "2026-07-14" } });
    const weekTask = task({ scope: { kind: "week", weekStart } });
    const outside = task({ scope: { kind: "day", date: "2026-07-20" } });
    const result = weekStats([dayTask, weekTask, outside], weekStart);
    expect(result).toEqual({ done: 0, total: 2 });
  });

  it("counts done tasks separately from total", () => {
    const done = task({ scope: { kind: "day", date: "2026-07-14" }, done: true });
    const undone = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    expect(weekStats([done, undone], weekStart)).toEqual({ done: 1, total: 2 });
  });
});

describe("dayTasksForWeek", () => {
  const weekStart = "2026-07-12"; // Sunday
  const date = "2026-07-14"; // Tuesday, in that week

  it("includes a task still day-scoped on that date", () => {
    const t = task({ scope: { kind: "day", date } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([t]);
  });

  it("includes a week-scoped task rolled over from that date", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date },
    });
    expect(dayTasksForWeek([rolled], date, weekStart)).toEqual([rolled]);
  });

  it("excludes a week-scoped task rolled over from a different date", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    expect(dayTasksForWeek([rolled], date, weekStart)).toEqual([]);
  });

  it("excludes a day-scoped task on a different date", () => {
    const t = task({ scope: { kind: "day", date: "2026-07-15" } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([]);
  });

  it("excludes a genuine week-level task with no rolledFrom", () => {
    const t = task({ scope: { kind: "week", weekStart } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: FAIL — `repeatCadenceLabel`, `repeatLabelForTask`, `weekStats`, `dayTasksForWeek` are not exported from `./times`.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/lib/times.ts`, add at the end of the file:

```ts
const REPEAT_DAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function repeatCadenceLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7) return "Daily";
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Weekdays";
  return sorted.map((d) => REPEAT_DAY_ABBR[d]).join("/");
}

export function repeatLabelForTask(task: Task, tasks: Task[]): string | undefined {
  if (task.repeatWeekdays && task.repeatWeekdays.length > 0) {
    return repeatCadenceLabel(task.repeatWeekdays);
  }
  if (task.repeatSourceId) {
    const anchor = tasks.find((t) => t.id === task.repeatSourceId);
    if (anchor?.repeatWeekdays && anchor.repeatWeekdays.length > 0) {
      return repeatCadenceLabel(anchor.repeatWeekdays);
    }
  }
  return undefined;
}

export interface WeekStats {
  done: number;
  total: number;
}

export function weekStats(tasks: Task[], weekStart: string): WeekStats {
  const inWeek = tasks.filter(
    (t) =>
      (t.scope.kind === "day" && weekStartOf(t.scope.date) === weekStart) ||
      (t.scope.kind === "week" && t.scope.weekStart === weekStart),
  );
  return {
    total: inWeek.length,
    done: inWeek.filter((t) => t.done).length,
  };
}

export function dayTasksForWeek(
  tasks: Task[],
  date: string,
  weekStart: string,
): Task[] {
  return tasks.filter(
    (t) =>
      (t.scope.kind === "day" && t.scope.date === date) ||
      (t.scope.kind === "week" &&
        t.scope.weekStart === weekStart &&
        t.rolledFrom?.kind === "day" &&
        t.rolledFrom.date === date),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/times.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: add repeat-label, week-stats, and rollover-aware day-task helpers"
```

---

### Task 4: `TaskItem` — add `highlight` and `repeatLabel` props

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Produces: `TaskItem` accepts two new optional props: `highlight?: "overdue" | "pending"` (renders a colored left border + tint on the row) and `repeatLabel?: string` (renders a small pill after the subtask-count badge). Both default to not-rendered when omitted — no visual change for any existing caller. Consumed by Task 5 (`ScopeTasks`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add these two `it` blocks inside the existing `describe("TaskItem v2", ...)` block (after the `dateLabel` test, before `renders the subtask list`):

```ts
  it("applies overdue styling when highlight is 'overdue'", () => {
    render(
      <TaskItem task={makeTask({ title: "late" })} {...noopHandlers} highlight="overdue" />,
    );
    const row = screen.getByText("late").closest("div");
    expect(row?.className).toContain("border-destructive");
  });

  it("applies pending styling when highlight is 'pending'", () => {
    render(
      <TaskItem task={makeTask({ title: "today" })} {...noopHandlers} highlight="pending" />,
    );
    const row = screen.getByText("today").closest("div");
    expect(row?.className).toContain("border-warning");
  });

  it("shows no highlight border when highlight is omitted", () => {
    render(<TaskItem task={makeTask({ title: "normal" })} {...noopHandlers} />);
    const row = screen.getByText("normal").closest("div");
    expect(row?.className).not.toContain("border-destructive");
    expect(row?.className).not.toContain("border-warning");
  });

  it("renders a repeat cadence pill when repeatLabel is set", () => {
    render(
      <TaskItem
        task={makeTask({ title: "gym" })}
        {...noopHandlers}
        repeatLabel="Weekdays"
      />,
    );
    expect(screen.getByText("Weekdays")).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx -t "highlight"`
Expected: FAIL — `highlight`/`repeatLabel` props don't exist yet, so the border classes and pill text are absent.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/task-item.tsx`, update the props destructuring and type:

```tsx
export function TaskItem({
  task,
  dateLabel,
  highlight,
  repeatLabel,
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
```

Update the row `<div>`'s className:

```tsx
      <div
        className={cn(
          "flex items-center gap-2 rounded-md py-1.5",
          highlight === "overdue" && "border-l-2 border-destructive bg-destructive/10 pl-1.5",
          highlight === "pending" && "border-l-2 border-warning bg-warning/10 pl-1.5",
        )}
      >
```

Add the pill span after the subtasks badge block, before the `rolledFrom` icon:

```tsx
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground"
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {repeatLabel && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
            {repeatLabel}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS, entire file green (this confirms no existing `TaskItem`/`ScopeTasks`/`PeriodCell` test broke).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add highlight and repeatLabel props to TaskItem"
```

---

### Task 5: `ScopeTasks` — add `onSelectTask`, `highlightOverdue`, `showRepeatLabel`

**Files:**
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `dayTasksForWeek`, `repeatLabelForTask` from `../lib/times` (Task 3); `weekStartOf` from `../lib/dates`; `TaskItem`'s `highlight`/`repeatLabel` props (Task 4).
- Produces: `ScopeTasks` accepts three new optional props:
  - `onSelectTask?: (id: string) => void` — passed through as each `TaskItem`'s `onSelect`.
  - `highlightOverdue?: boolean` (default `false`) — only meaningful when `scope.kind === "day"`. When true: (a) the day's item list is computed via `dayTasksForWeek` instead of a plain scope-key match, so same-week rolled-over tasks from that date are included; (b) each unfinished item gets `highlight="overdue"` if the box's date is before today, or `highlight="pending"` if it's today.
  - `showRepeatLabel?: boolean` (default `false`) — when true, each item's `repeatLabel` is resolved via `repeatLabelForTask`.
  All default to off, so `DailyView`, `MonthlyView`'s `YearGrid` previews, and every other current `ScopeTasks` caller are unaffected. Consumed by Task 7 (`WeeklyView`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add a new `describe` block at the end of the file (after `describe("ScopeTasks weekly rollup", ...)`):

```ts
describe("ScopeTasks day box (Weekly view props)", () => {
  it("calls onSelectTask instead of expanding inline when provided", async () => {
    const day = todayKey();
    const t = makeTask({ title: "click me", scope: { kind: "day", date: day } });
    const onSelectTask = vi.fn();
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} onSelectTask={onSelectTask} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("click me")).toBeTruthy());
    fireEvent.click(screen.getByText("click me"));
    expect(onSelectTask).toHaveBeenCalledWith(t.id);
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });

  it("with highlightOverdue, marks a past unfinished task overdue via its rolled-over week scope", async () => {
    const past = addDays(todayKey(), -2);
    const t = makeTask({ title: "old task", scope: { kind: "day", date: past } });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: past }} highlightOverdue />
      </TasksProvider>,
    );
    // rolloverTasks (run on load) has already converted this to week scope by
    // the time it renders, so this also proves the rolled-over item is found.
    await waitFor(() => expect(screen.getByText("old task")).toBeTruthy());
    const row = screen.getByText("old task").closest("div");
    expect(row?.className).toContain("border-destructive");
  });

  it("with highlightOverdue, marks today's unfinished task pending, not overdue", async () => {
    const day = todayKey();
    const t = makeTask({ title: "today task", scope: { kind: "day", date: day } });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} highlightOverdue />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("today task")).toBeTruthy());
    const row = screen.getByText("today task").closest("div");
    expect(row?.className).toContain("border-warning");
    expect(row?.className).not.toContain("border-destructive");
  });

  it("without highlightOverdue, a past unfinished task is not found by a day-scope query", async () => {
    const past = addDays(todayKey(), -2);
    const t = makeTask({ title: "rolled away", scope: { kind: "day", date: past } });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: past }} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("rolled away")).toBeNull();
  });

  it("with showRepeatLabel, renders the resolved cadence pill", async () => {
    const day = todayKey();
    const t = makeTask({
      title: "gym",
      scope: { kind: "day", date: day },
      repeatWeekdays: [1, 2, 3, 4, 5],
    });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} showRepeatLabel />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("gym")).toBeTruthy());
    expect(screen.getByText("Weekdays")).toBeTruthy();
  });

  it("without showRepeatLabel, no pill renders even for a repeating task", async () => {
    const day = todayKey();
    const t = makeTask({
      title: "gym",
      scope: { kind: "day", date: day },
      repeatWeekdays: [1, 2, 3, 4, 5],
    });
    render(
      <TasksProvider repository={fakeRepository([t])}>
        <ScopeTasks scope={{ kind: "day", date: day }} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("gym")).toBeTruthy());
    expect(screen.queryByText("Weekdays")).toBeNull();
  });
});
```

This block needs `todayKey` and `addDays` — both are already imported at the top of `primitives.test.tsx` (`import { addDays, shortDateLabel, todayKey, weekStartOf } from "../lib/dates";`), so no import changes are needed there.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx -t "Weekly view props"`
Expected: FAIL — `onSelectTask`/`highlightOverdue`/`showRepeatLabel` aren't recognized props yet, so behavior falls back to inline-expand and nothing is highlighted or labeled.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/scope-tasks.tsx`, update the imports:

```tsx
import { shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
import { compareTasksForDay, dayTasksForWeek, repeatLabelForTask, weeklyRollupTasks } from "../lib/times";
```

Update the props signature:

```tsx
export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
  excludeDate,
  onSelectTask,
  highlightOverdue = false,
  showRepeatLabel = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
  excludeDate?: string;
  onSelectTask?: (id: string) => void;
  highlightOverdue?: boolean;
  showRepeatLabel?: boolean;
}) {
```

Update the `items` computation to add a new branch (keep the existing `week` branch and the final `else` branch as-is, insert this one between them):

```tsx
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
```

Update the non-compact render block:

```tsx
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
          return (
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
        })}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS, entire file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/scope-tasks.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add onSelectTask, highlightOverdue, and showRepeatLabel to ScopeTasks"
```

---

### Task 6: `PeriodCell` — add `onDoubleClick`

**Files:**
- Modify: `frontend/src/features/tasks/components/period-cell.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Produces: `PeriodCell` accepts an optional `onDoubleClick?: () => void`, wired to the wrapper `<div>` in both the focused and unfocused render branches. Consumed by Task 8 (`YearGrid`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add these two tests inside the existing `describe("PeriodCell", ...)` block:

```ts
  it("calls onDoubleClick when the faded cell is double-clicked", () => {
    const onDoubleClick = vi.fn();
    render(
      <PeriodCell focused={false} onDoubleClick={onDoubleClick} label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    fireEvent.doubleClick(screen.getByText("content"));
    expect(onDoubleClick).toHaveBeenCalled();
  });

  it("calls onDoubleClick when the focused cell is double-clicked", () => {
    const onDoubleClick = vi.fn();
    render(
      <PeriodCell focused onDoubleClick={onDoubleClick} label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    fireEvent.doubleClick(screen.getByText("content"));
    expect(onDoubleClick).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx -t "onDoubleClick"`
Expected: FAIL — `onDoubleClick` isn't a recognized prop, so nothing is wired and the mock is never called.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/period-cell.tsx`, update the props:

```tsx
export function PeriodCell({
  focused,
  onFocus,
  onDoubleClick,
  label,
  className,
  contentClassName,
  children,
  "aria-label": ariaLabel,
}: {
  focused: boolean;
  onFocus?: () => void;
  onDoubleClick?: () => void;
  label?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
  "aria-label"?: string;
}) {
```

Wire it into the focused branch:

```tsx
  if (focused) {
    return (
      <div
        aria-label={ariaLabel}
        onDoubleClick={onDoubleClick}
        className={cn("rounded-md bg-card ring-1 ring-ring/40", className)}
      >
        {content}
      </div>
    );
  }
```

And into the unfocused branch (add the prop alongside the existing `onClick`):

```tsx
  return (
    <div
      aria-label={ariaLabel}
      role={onFocus ? "button" : undefined}
      tabIndex={onFocus ? 0 : undefined}
      onClick={onFocus}
      onDoubleClick={onDoubleClick}
      onKeyDown={
```

(the rest of the unfocused branch — `onKeyDown` body and `className` — is unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS, entire file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/period-cell.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add onDoubleClick to PeriodCell"
```

---

### Task 7: Rewrite `WeeklyView` — single week, hero box, bigger day boxes

**Files:**
- Modify: `frontend/src/features/tasks/components/views/weekly-view.tsx`
- Test: `frontend/src/features/tasks/components/views/weekly-view.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `weekStats`, `dayTasksForWeek` from `../../lib/times` (Task 3); `ScopeTasks`'s `onSelectTask`/`highlightOverdue`/`showRepeatLabel` (Task 5); `ViewKind` type from `../view-switcher`; `TaskDetailPanel`, `taskItemHandlers` (both already exist, used exactly as `DailyView` uses them).
- Produces:
  - `CalendarViewProps` gains a new optional field: `onDrillDown?: (view: ViewKind, dateKey: string) => void`. This interface is imported by `DailyView`, `MonthlyView`, `YearlyView` — all three keep compiling since the field is optional and none of them destructure it.
  - `WeeklyView` renders: a stats/progress hero (no task list), then 7 day boxes for `weekDates(weekStartOf(anchor))`. Clicking a task opens `TaskDetailPanel`; double-clicking a day's date button calls `onDrillDown("daily", date)`.
  - `DAY_LABELS` stays exported from this file, unchanged (`["Su","Mo","Tu","We","Th","Fr","Sa"]`).
  - Consumed by Task 9 (`task-calendar.tsx`, which supplies a working `onDrillDown`).

- [ ] **Step 1: Write the failing tests (full file rewrite)**

Replace the entire contents of `frontend/src/features/tasks/components/views/weekly-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { WeeklyView } from "./weekly-view";

const ANCHOR = "2026-07-16"; // Thursday; week: 2026-07-12 .. 2026-07-18

function renderView(onDrillDown = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={onDrillDown} />
    </TasksProvider>,
  );
  return onDrillDown;
}

describe("WeeklyView", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, matches ANCHOR
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders exactly 7 day boxes for the anchor's week, Sunday through Saturday", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("Su 12")).toBeTruthy());
    expect(screen.getByText("Sa 18")).toBeTruthy();
    expect(screen.getAllByLabelText(/^Go to 2026-07-1[2-8]$/)).toHaveLength(7);
  });

  it("shows the hero's done/total count, 0 when nothing is done", async () => {
    const a = makeTask({ title: "a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("This Week")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("counts a done task in the hero total", async () => {
    const a = makeTask({ title: "a", done: true, scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("excludes a task from another week from the hero count", async () => {
    const outside = makeTask({ title: "outside", scope: { kind: "day", date: "2026-07-20" } });
    renderView(vi.fn(), [outside]);
    await waitFor(() => expect(screen.getByText("This Week")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("/0")).toBeTruthy();
  });

  it("marks a past unfinished task overdue and today's unfinished task pending", async () => {
    const overdue = makeTask({
      id: "o",
      title: "overdue task",
      scope: { kind: "day", date: "2026-07-14" },
    });
    const pending = makeTask({
      id: "p",
      title: "pending task",
      scope: { kind: "day", date: "2026-07-16" },
    });
    renderView(vi.fn(), [overdue, pending]);
    await waitFor(() => expect(screen.getByText("overdue task")).toBeTruthy());
    expect(screen.getByText("overdue task").closest("div")?.className).toContain(
      "border-destructive",
    );
    expect(screen.getByText("pending task").closest("div")?.className).toContain(
      "border-warning",
    );
  });

  it("shows a repeat cadence pill on a repeating task", async () => {
    const repeating = makeTask({
      id: "r",
      title: "gym",
      scope: { kind: "day", date: "2026-07-14" },
      repeatWeekdays: [1, 3, 5],
    });
    renderView(vi.fn(), [repeating]);
    await waitFor(() => expect(screen.getByText("gym")).toBeTruthy());
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
  });

  it("opens the detail panel when a task is clicked, and closes it on re-click", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "task a" }));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "task a" }));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("calls onDrillDown('daily', date) when a day's date is double-clicked", async () => {
    const onDrillDown = renderView();
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Go to 2026-07-14"));
    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: FAIL — the current `WeeklyView` renders the old month-stack, has no "This Week" hero, no `Go to <date>`-labeled buttons, and doesn't accept/call `onDrillDown`.

- [ ] **Step 3: Implement — replace the entire contents of `weekly-view.tsx`**

```tsx
"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { dayOfMonth, todayKey, weekDates, weekStartOf } from "../../lib/dates";
import { dayTasksForWeek, weekStats } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";
import { ScopeTasks } from "../scope-tasks";
import { TaskDetailPanel } from "../task-detail-panel";
import { taskItemHandlers } from "../task-item";

export interface CalendarViewProps {
  anchor: string;
  onAnchorChange: (dateKey: string) => void;
  onDrillDown?: (view: ViewKind, dateKey: string) => void;
}

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
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
        <div className="shrink-0">
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTaskId(null)}
            {...taskItemHandlers(selectedTask.id, actions)}
          />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1.5">
        {dates.map((date, i) => {
          const dayTasks = dayTasksForWeek(tasks, date, weekStart);
          const dayDone = dayTasks.filter((t) => t.done).length;
          return (
            <div
              key={date}
              className="flex min-h-0 flex-col rounded-md bg-card p-1.5 ring-1 ring-ring/40"
            >
              <div className="mb-1 flex shrink-0 items-center justify-between">
                <button
                  type="button"
                  onDoubleClick={() => onDrillDown?.("daily", date)}
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

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full suite to check for breakage in other views**

Run: `cd frontend && npx vitest run`
Expected: `daily-view.test.tsx`, `year-views.test.tsx`, and `task-calendar.test.tsx` will now show failures — this is expected and fixed in Tasks 8–9 (they reference the old `CalendarViewProps` shape / old `WeeklyView` behavior indirectly via `task-calendar.test.tsx`, and Monthly/Yearly aren't wired to `onDrillDown` yet). Confirm the *only* new failures are in `year-views.test.tsx` and `task-calendar.test.tsx`, and that `weekly-view.test.tsx`, `daily-view.test.tsx`, and `primitives.test.tsx` are green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/views/weekly-view.tsx frontend/src/features/tasks/components/views/weekly-view.test.tsx
git commit -m "feat: redesign WeeklyView as a single week with a stats hero and bigger day boxes"
```

---

### Task 8: Wire month→week double-click drill-down (`YearGrid` + `MonthlyView`)

**Files:**
- Modify: `frontend/src/features/tasks/components/views/year-grid.tsx`
- Modify: `frontend/src/features/tasks/components/views/monthly-view.tsx`
- Test: `frontend/src/features/tasks/components/views/year-views.test.tsx`

**Interfaces:**
- Consumes: `PeriodCell`'s `onDoubleClick` (Task 6); `CalendarViewProps.onDrillDown` (Task 7).
- Produces: `YearGrid` accepts a new optional `onDrillDownMonth?: (monthKey: string) => void`, wired to `PeriodCell`'s `onDoubleClick` only in the `focusedMonth`-driven branch (the only branch `MonthlyView` uses; `YearlyView` still passes nothing here, so its month cells stay non-interactive as today). `MonthlyView` forwards `onDrillDown` from its own `CalendarViewProps` into `onDrillDownMonth`, translating a month key into `weekly` view + that month's first day. Consumed by Task 9 (`task-calendar.tsx`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/views/year-views.test.tsx`, add this test inside the `describe("MonthlyView", ...)` block:

```ts
  it("double-clicking a month cell drills down to weekly view at that month's first day", async () => {
    const onDrillDown = vi.fn();
    render(
      <TasksProvider repository={fakeRepository()}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={onDrillDown} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Focus March" }));
    expect(onDrillDown).toHaveBeenCalledWith("weekly", "2026-03-01");

    // The currently-focused month (July) isn't a button, but still double-clicks.
    fireEvent.doubleClick(screen.getByLabelText("Focus July"));
    expect(onDrillDown).toHaveBeenCalledWith("weekly", "2026-07-01");
  });

  it("does nothing on double-click when onDrillDown isn't provided", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    // Should not throw.
    fireEvent.doubleClick(screen.getByRole("button", { name: "Focus March" }));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/year-views.test.tsx -t "drill"`
Expected: FAIL — `MonthlyView` doesn't accept/forward `onDrillDown` yet, so `onDrillDown` is never called.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/views/year-grid.tsx`, update the props:

```tsx
export function YearGrid({
  year,
  focusedMonth,
  onFocusMonth,
  onDrillDownMonth,
  sideLabel,
  sideScope,
}: {
  year: string;
  focusedMonth?: string;
  onFocusMonth?: (monthKey: string) => void;
  onDrillDownMonth?: (monthKey: string) => void;
  sideLabel: string;
  sideScope: Scope;
}) {
```

Wire it into the `PeriodCell` in the focused-mode branch:

```tsx
            return (
              <PeriodCell
                key={month}
                focused={month === focusedMonth}
                onFocus={() => onFocusMonth?.(month)}
                onDoubleClick={
                  onDrillDownMonth ? () => onDrillDownMonth(month) : undefined
                }
                aria-label={`Focus ${name}`}
                label={name}
                className="flex h-24 flex-col p-1.5"
                contentClassName="min-h-0 flex-1 overflow-y-auto"
              >
                {preview}
              </PeriodCell>
            );
```

In `frontend/src/features/tasks/components/views/monthly-view.tsx`, replace the full contents:

```tsx
"use client";

import { monthKeyOf, yearOf } from "../../lib/dates";
import type { CalendarViewProps } from "./weekly-view";
import { YearGrid } from "./year-grid";

export function MonthlyView({ anchor, onAnchorChange, onDrillDown }: CalendarViewProps) {
  const focusedMonth = monthKeyOf(anchor);
  return (
    <YearGrid
      year={yearOf(anchor)}
      focusedMonth={focusedMonth}
      onFocusMonth={(month) => onAnchorChange(`${month}-01`)}
      onDrillDownMonth={
        onDrillDown ? (month) => onDrillDown("weekly", `${month}-01`) : undefined
      }
      sideLabel="Monthly"
      sideScope={{ kind: "month", month: focusedMonth }}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/year-views.test.tsx`
Expected: PASS, all tests in the file green (including the pre-existing `MonthlyView`/`YearlyView` tests, unaffected since `onDrillDown`/`onDrillDownMonth` are optional).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/views/year-grid.tsx frontend/src/features/tasks/components/views/monthly-view.tsx frontend/src/features/tasks/components/views/year-views.test.tsx
git commit -m "feat: wire month cell double-click to drill down into the Weekly view"
```

---

### Task 9: `task-calendar.tsx` — week-stepping navigation and drill-down wiring

**Files:**
- Modify: `frontend/src/features/tasks/components/task-calendar.tsx`
- Test: `frontend/src/features/tasks/components/task-calendar.test.tsx`

**Interfaces:**
- Consumes: `weekRangeLabel` (Task 2); `CalendarViewProps.onDrillDown` (Task 7); `MonthlyView`'s and `WeeklyView`'s now-optional `onDrillDown` prop (Tasks 7–8).
- Produces: `shiftAnchor`'s `"weekly"` case now steps by exactly 7 days instead of jumping to the 1st of the next/previous month. `dateLabelFor`'s `"weekly"` case now returns a week-range label instead of the month name. `CalendarInner` passes a working `onDrillDown` to whichever view is active, which changes both `view` and `anchor` together.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/task-calendar.test.tsx`, replace the `"weekly pages by month to the 1st"` test:

```ts
  it("weekly pages by exactly one week", () => {
    expect(shiftAnchor("weekly", "2026-07-16", 1)).toBe("2026-07-23");
    expect(shiftAnchor("weekly", "2026-07-16", -1)).toBe("2026-07-09");
    expect(shiftAnchor("weekly", "2026-07-31", 1)).toBe("2026-08-07"); // crosses a month
  });
```

Update the top-level `"defaults to the weekly view and switches scales"` test — it currently asserts `screen.getByText("Su")` as a proxy for "the weekly grid rendered"; since the rewritten `WeeklyView` no longer has a standalone `"Su"` text node (it's combined into `"Su 12"` etc. inside each day box), replace that assertion:

```ts
  it("defaults to the weekly view and switches scales", async () => {
    render(<TaskCalendar />);
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Weekly", selected: true }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("This Week")).toBeTruthy(); // weekly hero box

    fireEvent.click(screen.getByRole("tab", { name: "Yearly" }));
    await waitFor(() => expect(screen.getByText("January")).toBeTruthy());
  });
```

In the `"fixed sub-header"` describe block, update the expected label (the default view is `weekly`, anchor is `2026-07-16` under the pinned system time, whose week is `2026-07-12`–`2026-07-18`):

```ts
    it("shows a date label matching the current view, and keeps tabs/nav/label together as one non-shrinking block", async () => {
      render(<TaskCalendar />);
      await waitFor(() => expect(screen.getByText("Jul 12 – Jul 18")).toBeTruthy());

      const header = screen.getByText("Jul 12 – Jul 18").parentElement;
      expect(
        header?.contains(screen.getByRole("tablist", { name: "Calendar scale" })),
      ).toBe(true);
      expect(header?.contains(screen.getByText("Today"))).toBe(true);
      expect(header?.className).toContain("shrink-0");

      fireEvent.click(screen.getByRole("tab", { name: "Daily" }));
      await waitFor(() =>
        expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
      await waitFor(() => expect(screen.getByText("2026")).toBeTruthy());
    });
```

Add a new `describe` block at the end of the file for drill-down, reusing the same pinned system time:

```ts
describe("drill-down navigation", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, Thursday
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("double-clicking a Weekly day date switches to Daily anchored on that date", async () => {
    render(<TaskCalendar />);
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Go to 2026-07-14"));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Daily", selected: true })).toBeTruthy(),
    );
    expect(screen.getByText("Tuesday, July 14")).toBeTruthy();
  });

  it("double-clicking a Monthly month cell switches to Weekly anchored on that month's first week", async () => {
    render(<TaskCalendar />);
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: FAIL — `shiftAnchor`'s weekly case still jumps by month, `dateLabelFor` still shows the month name, and `CalendarInner` doesn't pass `onDrillDown` to the active view.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/task-calendar.tsx`, update the imports:

```tsx
import { addDays, dayLabel, todayKey, weekRangeLabel, weekStartOf, yearOf } from "../lib/dates";
```

Update `shiftAnchor`:

```tsx
export function shiftAnchor(
  view: ViewKind,
  anchor: string,
  dir: 1 | -1,
): string {
  switch (view) {
    case "daily":
      return addDays(anchor, dir);
    case "weekly":
      return addDays(anchor, 7 * dir);
    case "monthly":
    case "yearly":
      return `${Number(yearOf(anchor)) + dir}-${anchor.slice(5, 7)}-01`;
  }
}
```

Update `dateLabelFor`:

```tsx
function dateLabelFor(view: ViewKind, anchor: string): string {
  switch (view) {
    case "daily":
      return dayLabel(anchor);
    case "weekly":
      return weekRangeLabel(weekStartOf(anchor));
    case "monthly":
    case "yearly":
      return yearOf(anchor);
  }
}
```

Update the `View` render in `CalendarInner` to pass `onDrillDown`:

```tsx
      <div className="min-h-0 flex-1">
        <View
          anchor={anchor}
          onAnchorChange={setAnchor}
          onDrillDown={(nextView, dateKey) => {
            setView(nextView);
            setAnchor(dateKey);
          }}
        />
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — every test file green, including `daily-view.test.tsx`, `year-views.test.tsx`, `primitives.test.tsx`, `weekly-view.test.tsx`, and this file. This confirms the whole feature integrates cleanly.

- [ ] **Step 6: Lint and typecheck**

Run: `cd frontend && npm run lint`
Expected: no errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/task-calendar.tsx frontend/src/features/tasks/components/task-calendar.test.tsx
git commit -m "feat: step the Weekly tab by week and wire drill-down navigation end-to-end"
```

---

## Manual verification (after all tasks)

Run `cd frontend && npm run dev`, open the app, and check:

1. Weekly tab shows one week (Su–Sa) with visibly bigger boxes than before, plus the stats/progress hero on top.
2. Prev/Next on the Weekly tab move by exactly one week; the header shows a date range like "Jul 12 – Jul 18".
3. Add a task for a past date (e.g. via the Daily tab, then navigate back), leave it unfinished, and confirm it shows up red-bordered in its original day box on the Weekly tab — not silently missing.
4. Add a task for today, leave it unfinished — confirm it's yellow-bordered, not red.
5. Add a repeating task (any weekday combo) — confirm the cadence pill appears (e.g. "Weekdays", "Mo/We/Fr").
6. Click a task in a day box — confirm the detail panel opens; click again — confirm it closes.
7. Double-click a day's date in the Weekly tab — confirm it jumps to the Daily tab on that date.
8. Go to the Monthly tab, double-click a month cell — confirm it jumps to the Weekly tab on that month's first week.
9. Single-click still works as before in the Monthly tab (focuses the month without leaving the tab).
