# Daily/Weekly Panel Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three issues in the shipped Daily-tab task detail panel: it should render above the Weekly list (not below), the anchor day's own tasks should never duplicate into the Weekly list, and the panel header should hold checkbox/title/time on one line.

**Architecture:** Three independent, additive changes to existing components — no new state, no store changes. (1) `ShrinkStack`'s existing `secondaryFirst` prop flips render order in `DailyView`. (2) `ScopeTasks` gains an `excludeDate` filter, applied unconditionally by `DailyView`. (3) The time `<input>` + Clear button is extracted from `TaskDetailFields` into a new `TaskTimeEditor`, reused inline in `TaskDetailPanel`'s header, with `TaskDetailFields` gaining a `showTime` flag to avoid rendering it twice.

**Tech Stack:** Next.js, React 19, TypeScript, Vitest + @testing-library/react, Tailwind.

**Working directory:** All file paths below are relative to the worktree's `frontend/` directory, i.e. `.claude/worktrees/daily-weekly-panel-fixes/frontend/`. Run test commands from inside that `frontend/` directory.

## Global Constraints

- `secondaryFirst` on `ShrinkStack` swaps visual position only — `primary` (the Weekly list) keeps its 200px floor; no other `ShrinkStack` props change.
- `excludeDate` filtering is unconditional — it does not depend on `selectedTaskId` — and only ever passed by `DailyView`. `ScopeTasks` is also used by the standalone Weekly tab view and for non-`week` scopes; those callers pass no `excludeDate` and must be unaffected.
- `excludeDate` filters on the task's own scope (`scope.kind === "day" && scope.date === excludeDate`), never on the rollup's display `date` field — a week-scoped task merely *rolled over from* that date must still show.
- The time input + Clear button must be extracted **verbatim** (same markup, classes, `aria-label="Task time"`) into `TaskTimeEditor` — no visual or behavioral change for existing callers.
- `TaskDetailFields`'s `showTime` prop defaults to `true` — no change for its existing callers (`TaskItem`'s inline expansion).
- No changes to `weeklyRollupTasks`, the standalone Weekly tab view, or the rail/panel open-close-swap logic.

---

### Task 1: `ScopeTasks` gains `excludeDate`

**Files:**
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx` (existing `describe("ScopeTasks weekly rollup", ...)` block, lines 242-286)

**Interfaces:**
- Produces: `ScopeTasks({ scope, quickAdd, compact, excludeDate }: { scope: Scope; quickAdd?: boolean; compact?: boolean; excludeDate?: string })` — the new `excludeDate` prop is optional and consumed only by `DailyView` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add two new `it` blocks at the end of the `describe("ScopeTasks weekly rollup", ...)` block in `primitives.test.tsx` (right before its closing `});` at line 286):

```tsx
  it("excludes a day-scoped task dated excludeDate", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd excludeDate={future} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("day task")).toBeNull();
  });

  it("keeps a week-scoped task rolled over from excludeDate", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const rolledTask = makeTask({
      id: "w",
      title: "rolled task",
      scope: { kind: "week", weekStart: week },
      rolledFrom: { kind: "day", date: future },
    });
    render(
      <TasksProvider repository={fakeRepository([rolledTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} excludeDate={future} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("rolled task")).toBeTruthy());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: the new "excludes a day-scoped task dated excludeDate" test FAILS (`excludeDate` prop doesn't exist yet, task still renders).

- [ ] **Step 3: Implement `excludeDate` in `ScopeTasks`**

In `frontend/src/features/tasks/components/scope-tasks.tsx`, update the props destructure and add the filter right after `items` is computed (before the `compact`/full-row branch):

```tsx
export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
  excludeDate,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
  excludeDate?: string;
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

  if (excludeDate) {
    items = items.filter(
      (i) => !(i.task.scope.kind === "day" && i.task.scope.date === excludeDate),
    );
  }
```

(Everything below this in the file — the `compact` branch and the full render — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (all tests in the file, including the two new ones and the three pre-existing `ScopeTasks weekly rollup` tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/scope-tasks.tsx src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add excludeDate filter to ScopeTasks"
```

---

### Task 2: Wire `DailyView` — panel above the list, anchor day excluded

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx`
- Test: `frontend/src/features/tasks/components/views/daily-view.test.tsx`

**Interfaces:**
- Consumes: `ScopeTasks`'s `excludeDate?: string` prop (Task 1); `ShrinkStack`'s existing `secondaryFirst?: boolean` prop (`frontend/src/components/shrink-stack.tsx`, already implemented — swaps only which pane renders first, `primary` keeps its floor).

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe("DailyView task detail panel", ...)` block in `daily-view.test.tsx` (lines 65-119) with:

```tsx
describe("DailyView task detail panel", () => {
  // The anchor day's own day-scoped tasks are excluded from the Weekly
  // rollup unconditionally (ScopeTasks' excludeDate), so a task only ever
  // shows in the all-day zone plus (once selected) the panel header — never
  // in the Weekly list too. Clicks are scoped to the all-day zone via
  // `within` since a bare `getByText` would otherwise be ambiguous once a
  // panel is open.
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // all-day zone only

    const allDayZone = screen.getByTestId("all-day-zone");
    fireEvent.click(within(allDayZone).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    // Daily-tab row + panel header (never the Weekly list)
    expect(screen.getAllByText("task a")).toHaveLength(2);

    fireEvent.click(within(allDayZone).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the panel when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    const allDayZone = screen.getByTestId("all-day-zone");
    fireEvent.click(within(allDayZone).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(within(allDayZone).getByText("task a"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the panel", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("all-day-zone")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("renders the detail panel before the weekly list in document order", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("all-day-zone")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    const panelPane = screen.getByTestId("shrink-stack-secondary");
    const listPane = screen.getByTestId("shrink-stack-primary");
    expect(
      panelPane.compareDocumentPosition(listPane) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — the count assertions (`toHaveLength(1)` / `toHaveLength(2)`) fail because `excludeDate` isn't wired yet (task still appears in the Weekly list too), and the document-order test fails because `secondaryFirst` isn't set (currently primary renders first).

- [ ] **Step 3: Wire `secondaryFirst` and `excludeDate` in `DailyView`**

In `frontend/src/features/tasks/components/views/daily-view.tsx`, update the `weeklyList` definition and the `ShrinkStack` call:

```tsx
  const weeklyList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 shrink-0 text-xs font-semibold">Weekly</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ScopeTasks scope={{ kind: "week", weekStart: weekStart }} quickAdd excludeDate={anchor} />
      </div>
    </div>
  );

  return (
    <div className="grid h-full grid-cols-2 gap-1.5">
      <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
        <DayTimeline date={anchor} onSelectTask={handleSelectTask} />
      </div>
      <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
        {selectedTask ? (
          <ShrinkStack
            primary={weeklyList}
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
          weeklyList
        )}
      </div>
    </div>
  );
```

(Only the `excludeDate={anchor}` addition on `ScopeTasks` and the `secondaryFirst` addition on `ShrinkStack` change; everything else in the file is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS (all tests in the file, including the new document-order test).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/views/daily-view.tsx src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: render Daily-tab detail panel above the weekly list, exclude anchor day"
```

---

### Task 3: Extract `TaskTimeEditor`

**Files:**
- Create: `frontend/src/features/tasks/components/task-time-editor.tsx`
- Test: `frontend/src/features/tasks/components/task-time-editor.test.tsx` (new)

**Interfaces:**
- Produces: `TaskTimeEditor({ time, onTimeChange }: { time?: string; onTimeChange: (time?: string) => void })`, rendering an `<input type="time" aria-label="Task time">` plus a conditional "Clear" button. Consumed by Task 4 (`TaskDetailFields`) and Task 5 (`TaskDetailPanel`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/tasks/components/task-time-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskTimeEditor } from "./task-time-editor";

describe("TaskTimeEditor", () => {
  it("renders the time input with the given value", () => {
    render(<TaskTimeEditor time="14:00" onTimeChange={() => {}} />);
    expect((screen.getByLabelText("Task time") as HTMLInputElement).value).toBe("14:00");
  });

  it("calls onTimeChange with the new value on change", () => {
    const onTimeChange = vi.fn();
    render(<TaskTimeEditor time="14:00" onTimeChange={onTimeChange} />);
    fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
  });

  it("shows Clear only when a time is set, and calls onTimeChange(undefined) from it", () => {
    const onTimeChange = vi.fn();
    const { rerender } = render(<TaskTimeEditor onTimeChange={onTimeChange} />);
    expect(screen.queryByText("Clear")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" onTimeChange={onTimeChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onTimeChange).toHaveBeenCalledWith(undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/components/task-time-editor.test.tsx`
Expected: FAIL with a module-not-found error (`task-time-editor.tsx` doesn't exist yet).

- [ ] **Step 3: Create `TaskTimeEditor`**

Create `frontend/src/features/tasks/components/task-time-editor.tsx`, extracting the time row verbatim out of the current `TaskDetailFields`:

```tsx
"use client";

export function TaskTimeEditor({
  time,
  onTimeChange,
}: {
  time?: string;
  onTimeChange: (time?: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={time ?? ""}
        onChange={(e) => onTimeChange(e.target.value || undefined)}
        aria-label="Task time"
        className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {time && (
        <button
          type="button"
          onClick={() => onTimeChange(undefined)}
          className="text-xs text-subtle hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/components/task-time-editor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/task-time-editor.tsx src/features/tasks/components/task-time-editor.test.tsx
git commit -m "feat: extract TaskTimeEditor from TaskDetailFields"
```

---

### Task 4: `TaskDetailFields` uses `TaskTimeEditor`, gains `showTime`

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-fields.test.tsx` (new)

**Interfaces:**
- Consumes: `TaskTimeEditor` (Task 3).
- Produces: `TaskDetailFields` gains `showTime?: boolean` (default `true`); all other props unchanged.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-detail-fields.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailFields } from "./task-detail-fields";

const noopHandlers = {
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailFields showTime", () => {
  it("shows the time input by default", () => {
    render(<TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} />);
    expect(screen.getByLabelText("Task time")).toBeTruthy();
  });

  it("skips the time input when showTime is false", () => {
    render(
      <TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} showTime={false} />,
    );
    expect(screen.queryByLabelText("Task time")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: FAIL on the second test (`showTime` prop doesn't exist yet — time input always renders).

- [ ] **Step 3: Implement `showTime` in `TaskDetailFields`**

Replace the full contents of `frontend/src/features/tasks/components/task-detail-fields.tsx`:

```tsx
"use client";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  showTime = true,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  showTime?: boolean;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div className="space-y-1.5">
      {showTime && <TaskTimeEditor time={task.time} onTimeChange={onTimeChange} />}
      <textarea
        defaultValue={task.memo ?? ""}
        onBlur={(e) => onMemoChange(e.target.value)}
        placeholder="Memo"
        rows={2}
        className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
      />
      <button
        type="button"
        onClick={onDelete}
        className="text-xs text-destructive hover:underline"
      >
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS

Then also run the pre-existing coverage that exercises `TaskDetailFields` through `TaskItem`'s inline expansion, to confirm no regression:

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (in particular `"edits and clears the time from the expansion"` under `describe("TaskItem v2", ...)`, which relies on `showTime` defaulting to `true`).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/task-detail-fields.tsx src/features/tasks/components/task-detail-fields.test.tsx
git commit -m "feat: add showTime toggle to TaskDetailFields"
```

---

### Task 5: `TaskDetailPanel` — same-line header

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-panel.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `TaskTimeEditor` (Task 3); `TaskDetailFields`'s `showTime` prop (Task 4).

- [ ] **Step 1: Write the failing tests**

Add two new `it` blocks at the end of the `describe("TaskDetailPanel", ...)` block in `task-detail-panel.test.tsx` (before its closing `});`):

```tsx
  it("shows a time input in the header and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailPanel task={timedTask} {...noopHandlers} />);
    expect(screen.getByLabelText("Task time")).toBeTruthy();
    expect(screen.getAllByText("Clear")).toHaveLength(1);
  });

  it("calls onTimeChange from the header time input", () => {
    const onTimeChange = vi.fn();
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailPanel task={timedTask} {...noopHandlers} onTimeChange={onTimeChange} />);
    fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/task-detail-panel.test.tsx`
Expected: FAIL — no element with `aria-label="Task time"` exists in the header yet.

- [ ] **Step 3: Add `TaskTimeEditor` to the header, pass `showTime={false}` below**

Replace the full contents of `frontend/src/features/tasks/components/task-detail-panel.tsx`:

```tsx
"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailPanel({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto rounded-md border border-border/60 p-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <TaskTimeEditor time={task.time} onTimeChange={onTimeChange} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 text-subtle hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <TaskDetailFields
        task={task}
        onMemoChange={onMemoChange}
        onTimeChange={onTimeChange}
        onDelete={onDelete}
        onAddSubtask={onAddSubtask}
        onToggleSubtask={onToggleSubtask}
        onRemoveSubtask={onRemoveSubtask}
        showTime={false}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-panel.test.tsx`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Full frontend test suite and manual check**

Run: `npx vitest run`
Expected: PASS across the whole suite (confirms no regressions in `daily-view.test.tsx`, `primitives.test.tsx`, or elsewhere).

Then manually verify in the browser (`npm run dev` from `frontend/`, Daily tab):
- Selecting a task on the anchor day shows its panel above the Weekly list.
- The anchor day's own tasks never appear in the Weekly list, with or without a panel open.
- The panel header shows checkbox, title, and an editable time field on one line, with no duplicate time field below.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/components/task-detail-panel.tsx src/features/tasks/components/task-detail-panel.test.tsx
git commit -m "feat: put checkbox, title, and time on one line in TaskDetailPanel header"
```
