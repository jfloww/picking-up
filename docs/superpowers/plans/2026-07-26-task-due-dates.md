# Task Due Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any non-routine task carry an optional due date, independent of its `scope`, and show it as a small badge on the task row.

**Architecture:** A new optional `dueDate?: string` field on `Task`, a pair of pure date-label helpers in `lib/dates.ts`, a `setDueDate` store action, a small `TaskDueDateEditor` component (mirrors the existing `TaskTimeEditor`), wired into `TaskDetailFields`/`TaskItem`/`TaskDetailDrawer` following the exact same per-field patterns already used for `priority`/`background`.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, Tailwind v4 + shadcn tokens, localStorage-backed repository (no backend involvement).

## Global Constraints

- No urgency gradient — only a flat badge plus a single binary overdue/not-overdue signal (per spec).
- Due-date editing is available only from the task detail view (drawer + inline expansion), never from quick-add.
- The due-date editor and badge must not appear for routine tasks (`repeatWeekdays !== undefined` or `repeatSourceId !== undefined`).
- Badge shows on `TaskItem` sizes `"default"` and `"large"` only, not `"timeline"`.
- `dueDate` format is `"YYYY-MM-DD"`, matching every other date key in this codebase (`scope.date`, `todayKey()`, etc.) — comparable lexicographically.
- Reference spec: `docs/superpowers/specs/2026-07-26-task-due-dates-design.md`.

---

### Task 1: Data model + date/label helpers

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Test: `frontend/src/features/tasks/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `parse`/`todayKey` internals in `dates.ts`).
- Produces:
  - `Task.dueDate?: string` field, consumed by Tasks 2–6.
  - `isOverdue(dueDate: string, today: string): boolean`, consumed by Tasks 5.
  - `dueDateLabel(dueDate: string, today: string): string`, consumed by Task 5.

- [ ] **Step 1: Write the failing tests for the new date helpers**

Add to `frontend/src/features/tasks/lib/dates.test.ts` (add `dueDateLabel` and `isOverdue` to the existing import list at the top, then add this new `describe` block anywhere in the file):

```ts
describe("dueDateLabel", () => {
  it("returns 'Due Today' when the due date is today", () => {
    expect(dueDateLabel("2026-07-16", "2026-07-16")).toBe("Due Today");
  });

  it("returns a weekday name for a due date 1 to 7 days out", () => {
    expect(dueDateLabel("2026-07-17", "2026-07-16")).toBe("Due Fri"); // 1 day out
    expect(dueDateLabel("2026-07-23", "2026-07-16")).toBe("Due Thu"); // 7 days out
  });

  it("returns a short date for a due date more than 7 days out", () => {
    expect(dueDateLabel("2026-07-24", "2026-07-16")).toBe("Due Jul 24"); // 8 days out
    expect(dueDateLabel("2026-08-14", "2026-07-16")).toBe("Due Aug 14");
  });

  it("returns a short date, not a weekday, for an already-past due date", () => {
    expect(dueDateLabel("2026-07-14", "2026-07-16")).toBe("Due Jul 14"); // 2 days ago
  });
});

describe("isOverdue", () => {
  it("is false when the due date is today", () => {
    expect(isOverdue("2026-07-16", "2026-07-16")).toBe(false);
  });

  it("is false when the due date is in the future", () => {
    expect(isOverdue("2026-07-17", "2026-07-16")).toBe(false);
  });

  it("is true when the due date is in the past", () => {
    expect(isOverdue("2026-07-15", "2026-07-16")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: FAIL — `dueDateLabel` and `isOverdue` are not exported from `./dates`.

- [ ] **Step 3: Add the `dueDate` field to `Task`**

In `frontend/src/features/tasks/types.ts`, add one line to the `Task` interface (after `background?: boolean;`):

```ts
  background?: boolean; // renders in the timeline's slim background lane instead of the regular overlap columns
  dueDate?: string; // "YYYY-MM-DD"; independent of scope; unset for routine tasks
```

- [ ] **Step 4: Implement the date helpers**

In `frontend/src/features/tasks/lib/dates.ts`, add at the end of the file:

```ts
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parse(toKey).getTime() - parse(fromKey).getTime()) / 86_400_000);
}

export function isOverdue(dueDate: string, today: string): boolean {
  return dueDate < today;
}

export function dueDateLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return "Due Today";
  if (diff > 0 && diff <= 7) {
    const weekday = parse(dueDate).toLocaleDateString("en-US", { weekday: "short" });
    return `Due ${weekday}`;
  }
  const d = parse(dueDate);
  return `Due ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/lib/dates.ts frontend/src/features/tasks/lib/dates.test.ts
git commit -m "feat: add dueDate field and date-label helpers for task due dates"
```

---

### Task 2: Store action — `setDueDate`, and clear `dueDate` when a task becomes a routine

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: `Task.dueDate` (Task 1).
- Produces: `setDueDate(id: string, dueDate: string | undefined): void` on `TasksContextValue`, consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/features/tasks/store.test.tsx`, near the existing `describe("priority action", ...)` block (around line 382):

```ts
  describe("due date action", () => {
    it("setDueDate sets and clears the field", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setDueDate("a", "2026-07-31"));
      expect(result.current.tasks[0].dueDate).toBe("2026-07-31");
      await waitFor(() => expect(repo.tasks[0].dueDate).toBe("2026-07-31"));

      act(() => result.current.setDueDate("a", undefined));
      expect(result.current.tasks[0].dueDate).toBeUndefined();
    });

    it("setRepeatWeekdays clears dueDate when weekdays become non-empty", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        dueDate: "2026-07-31",
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", [1, 3]));
      expect(result.current.tasks[0].dueDate).toBeUndefined();
      await waitFor(() => expect(repo.tasks[0].dueDate).toBeUndefined());
    });

    it("setRepeatWeekdays leaves dueDate untouched when weekdays are cleared", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        dueDate: "2026-07-31",
        repeatWeekdays: [1],
      });
      const { result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", []));
      expect(result.current.tasks[0].dueDate).toBe("2026-07-31");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx -t "due date action"`
Expected: FAIL — `result.current.setDueDate` is not a function; the second test fails because `dueDate` is not cleared.

- [ ] **Step 3: Add `setDueDate` to `TasksContextValue` and implement it**

In `frontend/src/features/tasks/store.tsx`, add to the `TasksContextValue` interface (near `setBackground`, around line 61):

```ts
  setDueDate: (id: string, dueDate: string | undefined) => void;
```

Add the implementation next to `setBackground` (around line 218-224):

```ts
      setDueDate(id, dueDate) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, dueDate };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
```

- [ ] **Step 4: Update `setRepeatWeekdays` to clear `dueDate` when weekdays become non-empty**

Replace the existing `setRepeatWeekdays` implementation (around line 178-185):

```ts
      setRepeatWeekdays(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = { ...current, repeatWeekdays: normalized };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
```

with:

```ts
      setRepeatWeekdays(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = {
          ...current,
          repeatWeekdays: normalized,
          dueDate: normalized ? undefined : current.dueDate,
        };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS, entire file green (this also re-verifies no existing `setRepeatWeekdays` test broke).

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add setDueDate store action; clear dueDate when a task becomes a routine"
```

---

### Task 3: `TaskDueDateEditor` component

**Files:**
- Create: `frontend/src/features/tasks/components/task-due-date-editor.tsx`
- Test: `frontend/src/features/tasks/components/task-due-date-editor.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure presentational component; `dueDate?: string` is just a plain string prop here).
- Produces: `TaskDueDateEditor({ dueDate, onDueDateChange, variant })` component, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-due-date-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDueDateEditor } from "./task-due-date-editor";

const noopHandlers = {
  onDueDateChange: () => {},
};

describe("TaskDueDateEditor", () => {
  it("renders the date input with the given value", () => {
    render(<TaskDueDateEditor dueDate="2026-07-31" {...noopHandlers} />);
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-07-31");
  });

  it("calls onDueDateChange with the new value on change", () => {
    const onDueDateChange = vi.fn();
    render(<TaskDueDateEditor dueDate="2026-07-31" onDueDateChange={onDueDateChange} />);
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-01" } });
    expect(onDueDateChange).toHaveBeenCalledWith("2026-08-01");
  });

  it("shows Clear only when a due date is set, and calls onDueDateChange(undefined) from it", () => {
    const onDueDateChange = vi.fn();
    const { rerender } = render(<TaskDueDateEditor onDueDateChange={onDueDateChange} />);
    expect(screen.queryByText("Clear")).toBeNull();

    rerender(<TaskDueDateEditor dueDate="2026-07-31" onDueDateChange={onDueDateChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onDueDateChange).toHaveBeenCalledWith(undefined);
  });

  it("shows a 'Due date' label only in the drawer variant", () => {
    const { rerender } = render(<TaskDueDateEditor {...noopHandlers} />);
    expect(screen.queryByText("Due date")).toBeNull();

    rerender(<TaskDueDateEditor {...noopHandlers} variant="drawer" />);
    expect(screen.getByText("Due date")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-due-date-editor.test.tsx`
Expected: FAIL — the module `./task-due-date-editor` does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/features/tasks/components/task-due-date-editor.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

export function TaskDueDateEditor({
  dueDate,
  onDueDateChange,
  variant = "default",
}: {
  dueDate?: string;
  onDueDateChange: (dueDate?: string) => void;
  variant?: "default" | "drawer";
}) {
  const drawer = variant === "drawer";
  return (
    <label className={cn("flex flex-col gap-1", drawer && "gap-1.5")}>
      {drawer && <span className="text-[11px] font-medium text-subtle">Due date</span>}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dueDate ?? ""}
          onChange={(e) => onDueDateChange(e.target.value || undefined)}
          aria-label="Due date"
          className={cn(
            "rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "px-2.5 py-1.5 text-sm",
          )}
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => onDueDateChange(undefined)}
            className={cn(
              "text-xs text-subtle hover:text-foreground",
              drawer && "text-sm hover:underline",
            )}
          >
            Clear
          </button>
        )}
      </div>
    </label>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-due-date-editor.test.tsx`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/task-due-date-editor.tsx frontend/src/features/tasks/components/task-due-date-editor.test.tsx
git commit -m "feat: add TaskDueDateEditor component"
```

---

### Task 4: Wire `TaskDueDateEditor` into `TaskDetailFields`

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`

**Interfaces:**
- Consumes: `TaskDueDateEditor` (Task 3), `Task.dueDate` (Task 1).
- Produces: `TaskDetailFields` gains `onDueDateChange: (dueDate?: string) => void` prop, consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests**

Add `onDueDateChange: (_dueDate?: string) => {}` to the `noopHandlers` object at the top of `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, then add this new `describe` block at the end of the file:

```tsx
describe("TaskDetailFields due date", () => {
  it("shows the due date editor for a non-routine task", () => {
    render(<TaskDetailFields task={makeTask({})} {...noopHandlers} />);
    expect(screen.getByLabelText("Due date")).toBeTruthy();
  });

  it("hides the due date editor for a routine anchor", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "day", date: "2026-07-16" }, repeatWeekdays: [1] })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Due date")).toBeNull();
  });

  it("hides the due date editor for a generated routine occurrence", () => {
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatSourceId: "anchor-1",
        })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Due date")).toBeNull();
  });

  it("calls onDueDateChange with the new value", () => {
    const onDueDateChange = vi.fn();
    render(
      <TaskDetailFields task={makeTask({})} {...noopHandlers} onDueDateChange={onDueDateChange} />,
    );
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
    expect(onDueDateChange).toHaveBeenCalledWith("2026-07-31");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx -t "due date"`
Expected: FAIL — no element with label "Due date" is rendered yet.

- [ ] **Step 3: Wire the editor into `TaskDetailFields`**

In `frontend/src/features/tasks/components/task-detail-fields.tsx`:

Add the import:

```ts
import { TaskDueDateEditor } from "./task-due-date-editor";
```

Add `onDueDateChange` to the props type and destructured parameters (next to `onBackgroundChange`):

```ts
  onDueDateChange,
```
```ts
  onDueDateChange: (dueDate?: string) => void;
```

Add a computed flag right after the existing `showRepeat` line (around line 50):

```ts
  const isRoutine = task.repeatWeekdays !== undefined || task.repeatSourceId !== undefined;
```

Add the new section right after the `showRepeat` block closes (after the `</section>` that closes the repeat block, before the Priority/Background `<div>`):

```tsx
      {!isRoutine && (
        <section className={cn(drawer && "space-y-3")}>
          <TaskDueDateEditor
            dueDate={task.dueDate}
            onDueDateChange={onDueDateChange}
            variant={variant}
          />
        </section>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS, entire file green.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: fails here, listing every caller of `TaskDetailFields` that doesn't yet pass `onDueDateChange` (`task-item.tsx`, `task-detail-drawer.tsx`) — expected at this point in the plan; Tasks 5 and 6 fix these call sites. Confirm the only errors are "Property 'onDueDateChange' is missing" at those two call sites, then proceed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx
git commit -m "feat: wire TaskDueDateEditor into TaskDetailFields, hidden for routines"
```

---

### Task 5: Wire due date through `TaskItem` (inline row + badge)

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `store.setDueDate` (Task 2, via the actions object passed in by callers), `TaskDetailFields`'s `onDueDateChange` prop (Task 4), `dueDateLabel`/`isOverdue` (Task 1).
- Produces: `TaskItem` gains an `onDueDateChange: (dueDate?: string) => void` prop and renders a due-date badge; `taskItemHandlers()` gains `onDueDateChange` in its return value, consumed by every view that spreads it (`daily-view.tsx`, `weekly-view.tsx`, etc. — no changes needed there since they just spread the object).

- [ ] **Step 1: Write the failing tests**

Add `onDueDateChange: (_dueDate?: string) => {}` to the `noopHandlers` object at the top of `frontend/src/features/tasks/components/primitives.test.tsx`, then add this new `describe` block after the existing `describe("TaskItem v2", ...)` block:

```tsx
describe("TaskItem due date badge", () => {
  it("renders no due-date badge when dueDate is unset", () => {
    render(<TaskItem task={makeTask({ title: "gym" })} {...noopHandlers} />);
    expect(screen.queryByText(/^Due /)).toBeNull();
  });

  it("renders 'Due Today' for a task due today, neutral (not red)", () => {
    render(
      <TaskItem
        task={makeTask({ title: "gym", dueDate: todayKey() })}
        {...noopHandlers}
      />,
    );
    const badge = screen.getByText("Due Today");
    expect(badge.className).not.toContain("text-destructive");
  });

  it("renders a red badge for an overdue, unfinished task", () => {
    const past = addDays(todayKey(), -2);
    render(
      <TaskItem
        task={makeTask({ title: "gym", dueDate: past, done: false })}
        {...noopHandlers}
      />,
    );
    const badge = screen.getByText(/^Due /);
    expect(badge.className).toContain("text-destructive");
  });

  it("stays neutral for an overdue but done task", () => {
    const past = addDays(todayKey(), -2);
    render(
      <TaskItem
        task={makeTask({ title: "gym", dueDate: past, done: true })}
        {...noopHandlers}
      />,
    );
    const badge = screen.getByText(/^Due /);
    expect(badge.className).not.toContain("text-destructive");
  });

  it("does not render the due-date badge on timeline size", () => {
    render(
      <TaskItem
        task={makeTask({ title: "gym", dueDate: todayKey() })}
        {...noopHandlers}
        size="timeline"
      />,
    );
    expect(screen.queryByText("Due Today")).toBeNull();
  });

  it("threads onDueDateChange to the inline TaskDetailFields expansion", () => {
    const onDueDateChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist" })}
        {...noopHandlers}
        onDueDateChange={onDueDateChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
    expect(onDueDateChange).toHaveBeenCalledWith("2026-07-31");
  });
});
```

`todayKey` and `addDays` are already imported at the top of this test file (line 4); no new import needed there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx -t "due date badge"`
Expected: FAIL — no due-date badge rendered, and `onDueDateChange` prop doesn't exist on `TaskItem` yet (TS error surfaces as a test failure/compile error).

- [ ] **Step 3: Add `setDueDate`/`onDueDateChange` to the actions plumbing**

In `frontend/src/features/tasks/components/task-item.tsx`, add to the `TaskItemActions` interface (next to `setBackground`):

```ts
  setDueDate: (id: string, dueDate: string | undefined) => void;
```

Add to `taskItemHandlers()`'s returned object (next to `onBackgroundChange`):

```ts
    onDueDateChange: (dueDate?: string) => actions.setDueDate(id, dueDate),
```

Add the import for the new date helpers, next to the existing `addMinutesToTime` import:

```ts
import { dueDateLabel, isOverdue, todayKey } from "../lib/dates";
```

- [ ] **Step 4: Add the `onDueDateChange` prop to `TaskItem` and pass it through**

Add `onDueDateChange` to the destructured props list and to the props type (next to `onBackgroundChange` in both places):

```ts
  onDueDateChange,
```
```ts
  onDueDateChange: (dueDate?: string) => void;
```

Pass it to the `TaskDetailFields` call inside the component body (next to `onBackgroundChange={onBackgroundChange}`):

```tsx
        onDueDateChange={onDueDateChange}
```

- [ ] **Step 5: Compute and render the badge**

Inside `TaskItem`, right after the existing `const timeBadge = ...` block, add:

```tsx
  const today = todayKey();
  const dueBadge = task.dueDate && !timeline && (
    <span
      className={cn(
        "shrink-0 rounded bg-muted font-medium text-muted-foreground",
        large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
        isOverdue(task.dueDate, today) && !task.done && "bg-destructive/10 text-destructive",
      )}
    >
      {dueDateLabel(task.dueDate, today)}
    </span>
  );
```

Render `{dueBadge}` in the badge row, immediately after the subtask-count `span` block and before the `repeatLabel` badge (around where `{subtasks.length > 0 && (...)}` ends):

```tsx
        {dueBadge}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS, entire file green (this also re-verifies every existing `TaskItem`/`ScopeTasks` test still passes with the new required prop supplied via `noopHandlers`).

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: fails only at `task-detail-drawer.tsx`'s `TaskDetailFields` call (missing `onDueDateChange`) and any direct `<TaskItem>`/`taskItemHandlers` call sites outside tests that don't yet supply the new action — expected at this point; Task 6 and a final sweep close these.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: render due-date badge on TaskItem, red only when overdue and not done"
```

---

### Task 6: Wire due date through `TaskDetailDrawer` (buffered until Done)

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

**Interfaces:**
- Consumes: `TaskDetailFields`'s `onDueDateChange` prop (Task 4), `TaskItemActions.setDueDate`/`taskItemHandlers().onDueDateChange` (Task 5, satisfies this component's own `onDueDateChange` prop since callers spread `taskItemHandlers()` onto it).
- Produces: nothing consumed further — this is the last task.

- [ ] **Step 1: Write the failing tests**

Add `onDueDateChange: (_dueDate?: string) => {}` to the `noopHandlers` object at the top of `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`, then add this new `describe` block after the existing `describe("draft editing (buffered until Done)", ...)` block:

```tsx
  describe("due date editing (buffered until Done)", () => {
    it("does not call onDueDateChange immediately when the due date is edited", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      expect(onDueDateChange).not.toHaveBeenCalled();
    });

    it("Done commits the edited due date", () => {
      const onDueDateChange = vi.fn();
      const onClose = vi.fn();
      render(
        <TaskDetailDrawer
          task={task}
          {...noopHandlers}
          onDueDateChange={onDueDateChange}
          onClose={onClose}
        />,
      );
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      fireEvent.click(screen.getByText("Done"));
      expect(onDueDateChange).toHaveBeenCalledWith("2026-07-31");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Done does not call onDueDateChange when the due date was never touched", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.click(screen.getByText("Done"));
      expect(onDueDateChange).not.toHaveBeenCalled();
    });

    it("Cancel discards the edited due date", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      fireEvent.click(screen.getByText("Cancel"));
      expect(onDueDateChange).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx -t "due date editing"`
Expected: FAIL — `onDueDateChange` prop doesn't exist on `TaskDetailDrawer` yet; no "Due date" field rendered.

- [ ] **Step 3: Add `dueDate` to `Draft` and thread it through**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`:

Add to the `Draft` interface:

```ts
  dueDate?: string;
```

Add to `draftFromTask`:

```ts
    dueDate: task.dueDate,
```

Add `onDueDateChange: (dueDate?: string) => void;` to the component's props type and destructured parameters (next to `onBackgroundChange`).

In `handleDone`, add one line next to the other field-diff checks:

```ts
    if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);
```

Pass `onDueDateChange={(dueDate) => setDraft((d) => ({ ...d, dueDate }))}` to the `TaskDetailFields` call, next to the other `on*Change` props. No change needed to `draftTask` — since `dueDate` is a plain field, it's already covered by the existing `{ ...task, ...draftFields }` spread (unlike `detached`, which needs special handling).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: PASS, entire file green.

- [ ] **Step 5: Typecheck the whole frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors anywhere in the project.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, no regressions anywhere (daily-view, weekly-view, monthly-view, yearly-view tests included, since they consume `taskItemHandlers()`/`TaskItem` unchanged).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx
git commit -m "feat: wire due date editing through TaskDetailDrawer, buffered until Done"
```
