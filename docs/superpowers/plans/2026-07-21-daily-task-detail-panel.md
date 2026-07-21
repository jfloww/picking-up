# Daily Task Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a task's title in the Daily tab's rail or All-day zone opens its details in a panel at the bottom of the Weekly column (which shrinks to make room, reusing `ShrinkStack`) instead of expanding inline. Weekly-column tasks keep today's inline expand.

**Architecture:** Extract the task-detail form fields (time/memo/subtasks/delete) out of `TaskItem` into a shared `TaskDetailFields` component. `TaskItem` gains an optional `onSelect` prop that, when provided, replaces its inline-toggle click with a callback. A new `TaskDetailPanel` (header + `TaskDetailFields`) becomes `ShrinkStack`'s `secondary` slot in the Weekly column, with the weekly list as `primary`. `DailyView` owns which task is selected and resolves it live from the tasks store each render.

**Tech Stack:** Next.js/React (TypeScript), Tailwind CSS, Vitest + `@testing-library/react`, lucide-react (icons, already a dependency).

## Global Constraints

- No new npm dependencies.
- Shared components use the `@/components/...` import alias (`ShrinkStack`); feature-internal files use relative imports, matching existing files in `frontend/src/features/tasks/`.
- Frontend tests run via `npm test` (`vitest run`) from `frontend/`; a single file can be targeted with `npx vitest run <path>`.
- `ScopeTasks`/the Weekly column keeps its existing inline-expand behavior unchanged — only Daily-tab (rail + All-day) tasks route to the new panel.
- `ShrinkStack`'s existing rail usage (`primaryMaxHeight={VIEWPORT_HEIGHT}`) must keep working unchanged after `primaryMaxHeight` becomes optional.

---

### Task 1: Extract `TaskDetailFields`; add `onSelect` to `TaskItem`

**Files:**
- Create: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.tsx` (full file, 143 lines)
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx:52-70` (add one test)

**Interfaces:**
- Produces: `TaskDetailFields` component, props `{ task: Task; onMemoChange: (memo: string) => void; onTimeChange: (time?: string) => void; onDelete: () => void; onAddSubtask: (title: string) => void; onToggleSubtask: (subtaskId: string) => void; onRemoveSubtask: (subtaskId: string) => void }`. Consumed by `TaskItem` (this task) and `TaskDetailPanel` (Task 2).
- Produces: `TaskItem` gains optional prop `onSelect?: () => void`. All other `TaskItem`/`taskItemHandlers` exports unchanged.

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add this test inside the `describe("TaskItem", ...)` block, right after the `"expands to memo + delete when the title is clicked"` test (after line 70):

```tsx
  it("calls onSelect instead of expanding inline when provided", () => {
    const onSelect = vi.fn();
    render(<TaskItem task={task} {...noopHandlers} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("write tests"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — `onSelect` isn't a recognized `TaskItem` prop yet, so clicking the title still toggles inline `open`, and `queryByPlaceholderText("Memo")` finds the expanded memo field instead of `null`.

- [ ] **Step 3: Create `TaskDetailFields`**

Create `frontend/src/features/tasks/components/task-detail-fields.tsx`:

```tsx
"use client";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={task.time ?? ""}
          onChange={(e) => onTimeChange(e.target.value || undefined)}
          aria-label="Task time"
          className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {task.time && (
          <button
            type="button"
            onClick={() => onTimeChange(undefined)}
            className="text-xs text-subtle hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
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

- [ ] **Step 4: Update `TaskItem` to use it and add `onSelect`**

Replace the full contents of `frontend/src/features/tasks/components/task-item.tsx` with:

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
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}

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
  onSelect,
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
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <li>
      <div className="flex items-center gap-2 py-1.5">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
        {task.time && (
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {task.time}
          </span>
        )}
        <button
          type="button"
          onClick={() => (onSelect ? onSelect() : setOpen((o) => !o))}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-base font-medium",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground"
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
      </div>
      {open && (
        <div className="mt-1 pl-6">
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 6: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS — `TaskDetailFields` renders the same markup `TaskItem`'s inline expansion did before (just one extra wrapping `div`, which no existing test's queries depend on).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: extract TaskDetailFields and add TaskItem onSelect"
```

---

### Task 2: `TaskDetailPanel` component

**Files:**
- Create: `frontend/src/features/tasks/components/task-detail-panel.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `TaskDetailFields` from `./task-detail-fields` (Task 1), same prop names.
- Produces: `TaskDetailPanel` component, props `{ task: Task; onToggle: () => void; onClose: () => void; onMemoChange: (memo: string) => void; onTimeChange: (time?: string) => void; onDelete: () => void; onAddSubtask: (title: string) => void; onToggleSubtask: (subtaskId: string) => void; onRemoveSubtask: (subtaskId: string) => void }`. Consumed by `DailyView` (Task 5) as `ShrinkStack`'s `secondary`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-detail-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailPanel } from "./task-detail-panel";

const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailPanel", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("shows the task's checkbox, title, and memo", () => {
    render(<TaskDetailPanel task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByText("write tests")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value,
    ).toBe("with care");
  });

  it("calls onToggle from the header checkbox", () => {
    const onToggle = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onDelete from the delete button", () => {
    const onDelete = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/task-detail-panel.test.tsx`
Expected: FAIL — `Cannot find module './task-detail-panel'` (component doesn't exist yet).

- [ ] **Step 3: Create `TaskDetailPanel`**

Create `frontend/src/features/tasks/components/task-detail-panel.tsx`:

```tsx
"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";

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
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-panel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-panel.tsx frontend/src/features/tasks/components/task-detail-panel.test.tsx
git commit -m "feat: add TaskDetailPanel component"
```

---

### Task 3: `ShrinkStack`'s `primaryMaxHeight` becomes optional

**Files:**
- Modify: `frontend/src/components/shrink-stack.tsx:9-17`
- Modify: `frontend/src/components/shrink-stack.test.tsx`

**Interfaces:**
- Produces: `ShrinkStackProps.primaryMaxHeight` changes from `number` to `number | undefined` (optional). All other props unchanged. The rail's existing call (`primaryMaxHeight={VIEWPORT_HEIGHT}`) is unaffected since passing a number still works.

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/shrink-stack.test.tsx`, add this test inside `describe("ShrinkStack", ...)`, after the last existing test:

```tsx
  it("omits maxHeight on the primary pane when primaryMaxHeight is not provided", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    expect(primary.style.minHeight).toBe("200px");
    expect(primary.style.maxHeight).toBe("");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/shrink-stack.test.tsx`
Expected: FAIL — a TypeScript error (`primaryMaxHeight` is currently required), surfaced by vitest as a compile/type failure for this test file.

- [ ] **Step 3: Make `primaryMaxHeight` optional**

In `frontend/src/components/shrink-stack.tsx`, change line 12 from:

```tsx
  primaryMaxHeight: number;
```

to:

```tsx
  primaryMaxHeight?: number;
```

No other changes needed — React omits a style property entirely when its value is `undefined`, so `style={{ minHeight: primaryMinHeight, maxHeight: primaryMaxHeight }}` (line 34, unchanged) already does the right thing once the prop can be `undefined`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/shrink-stack.test.tsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS — the rail's existing `primaryMaxHeight={VIEWPORT_HEIGHT}` call is a plain number, unaffected by widening the prop's type.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shrink-stack.tsx frontend/src/components/shrink-stack.test.tsx
git commit -m "feat: make ShrinkStack's primaryMaxHeight optional"
```

---

### Task 4: `DayTimeline` gains `onSelectTask`

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx:23,98,138`
- Modify: `frontend/src/features/tasks/components/day-timeline.test.tsx`

**Interfaces:**
- Produces: `DayTimeline` gains optional prop `onSelectTask?: (id: string) => void`, passed to every `TaskItem` (rail chips and All-day rows) as `onSelect={() => onSelectTask?.(t.id)}`. Consumed by `DailyView` (Task 5).

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`:

1. Update the `renderTimeline` helper (lines 17-23) to accept an optional third argument:

```tsx
function renderTimeline(
  date: string,
  tasks = [] as Parameters<typeof fakeRepository>[0],
  onSelectTask?: (id: string) => void,
) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayTimeline date={date} onSelectTask={onSelectTask} />
    </TasksProvider>,
  );
}
```

2. Add this test inside `describe("DayTimeline", ...)`, after the `"bounds the rail between a 6h floor and its 12h viewport via ShrinkStack"` test (after line 89):

```tsx
  it("calls onSelectTask instead of expanding inline, for both rail chips and All-day rows", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const onSelectTask = vi.fn();
    renderTimeline(day, [untimed, timed], onSelectTask);
    await waitFor(() => expect(screen.getByText("untimed")).toBeTruthy());

    fireEvent.click(screen.getByText("untimed"));
    expect(onSelectTask).toHaveBeenCalledWith("u");

    fireEvent.click(screen.getByText("dentist"));
    expect(onSelectTask).toHaveBeenCalledWith("t");

    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — `onSelectTask` isn't wired to anything yet, so clicking a title expands inline instead of calling the callback, and `onSelectTask` is never called.

- [ ] **Step 3: Wire `onSelectTask` into `DayTimeline`**

In `frontend/src/features/tasks/components/day-timeline.tsx`:

1. Change line 23 from:

```tsx
export function DayTimeline({ date }: { date: string }) {
```

to:

```tsx
export function DayTimeline({
  date,
  onSelectTask,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
}) {
```

2. Change line 98 from:

```tsx
                    <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
```

to:

```tsx
                    <TaskItem
                      task={t}
                      {...taskItemHandlers(t.id, actions)}
                      onSelect={() => onSelectTask?.(t.id)}
                    />
```

3. Change line 138 (the same pattern, in the All-day loop) from:

```tsx
                    <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
```

to:

```tsx
                    <TaskItem
                      task={t}
                      {...taskItemHandlers(t.id, actions)}
                      onSelect={() => onSelectTask?.(t.id)}
                    />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS — `onSelectTask` is optional and `onSelect` is optional on `TaskItem`, so every other existing caller/test (which doesn't pass either) keeps today's inline-toggle behavior.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: add onSelectTask to DayTimeline"
```

---

### Task 5: `DailyView` holds selection state and renders the panel

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx` (full file, 24 lines)
- Modify: `frontend/src/features/tasks/components/views/daily-view.test.tsx`

**Interfaces:**
- Consumes: `DayTimeline`'s `onSelectTask` prop (Task 4); `ShrinkStack`'s `primary`/`primaryMinHeight`/`secondary` props with `primaryMaxHeight` omitted (Task 3); `TaskDetailPanel` (Task 2); `taskItemHandlers` from `../task-item` (existing export, unchanged).
- No new exports — `DailyView`'s own props (`CalendarViewProps`) are unchanged.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/views/daily-view.test.tsx`:

1. Add `fireEvent` to the existing import (line 1) — change:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
```

to:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
```

2. Add this new `describe` block after the existing `describe("DailyView v3 (single-day layout)", ...)` block (after line 63):

```tsx
describe("DailyView task detail panel", () => {
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();

    fireEvent.click(screen.getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getAllByText("task a")).toHaveLength(2); // Daily-tab row + panel header

    fireEvent.click(screen.getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the panel", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    fireEvent.click(screen.getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — `DailyView` doesn't wire `onSelectTask` yet, so clicking a title expands inline instead of showing a panel; `"Close details"` is never found.

- [ ] **Step 3: Wire selection state and the panel into `DailyView`**

Replace the full contents of `frontend/src/features/tasks/components/views/daily-view.tsx` with:

```tsx
"use client";

import { useState } from "react";

import { ShrinkStack } from "@/components/shrink-stack";

import { weekStartOf } from "../../lib/dates";
import { useTasks } from "../../store";
import { DayTimeline } from "../day-timeline";
import { ScopeTasks } from "../scope-tasks";
import { taskItemHandlers } from "../task-item";
import { TaskDetailPanel } from "../task-detail-panel";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);
  const actions = useTasks();
  const { tasks } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));

  const weeklyList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 shrink-0 text-xs font-semibold">Weekly</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS.

- [ ] **Step 6: Manual browser verification**

Start the dev server (`npm run dev` from `frontend/`), open the Daily tab, and:
- Click a task's title in the All-day zone or on a rail chip — confirm the Weekly list visibly shrinks and the detail panel appears below it with the right task's checkbox, title, time, memo, subtasks, and a Delete button.
- Confirm the Weekly column never shows an outer scrollbar — only the weekly list (once at its floor) and the panel (once its content exceeds its own space) scroll internally.
- Click the same task's title again — panel closes, weekly list returns to full height.
- Click a different task — panel swaps to the new task.
- Delete the selected task from the panel — panel closes.
- Click a task in the Weekly list itself — confirm it still expands inline as before, not via the panel.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.tsx frontend/src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: show Daily-tab task details in a panel below the Weekly list"
```
