# Daily Tab Neural Noir Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight task `priority` flag, a same-day "time already passed" overdue state, nudge the app's dark theme toward the Neural Noir palette, split the Daily tab's agenda into three sections (All Day To-Do / Next Up / Done Today), and replace its in-place detail panel with a slide-in drawer overlay — scoped entirely to the Daily tab's data model, shared components, and two-column content area.

**Architecture:** Nine bottom-up tasks: a new optional `Task.priority` field threaded through the repository/store, a dark-theme token value change, one new pure time-comparison function, then component work in dependency order — `TaskDetailFields` gains the priority toggle first (since both `TaskItem`'s inline expansion and `TaskDetailPanel` render it), then `TaskItem`/`TaskDetailPanel` thread it through, then a brand-new `TaskDetailDrawer`, then `DayAgenda`'s three-section rewrite and `DayTimeline`'s same-day highlight (both consuming the new time-comparison function), and finally `DailyView` ties everything together.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Vitest + Testing Library. All commands below run from the `frontend/` directory.

## Global Constraints

- No hardcoded hex or arbitrary colors in any component — only `frontend/src/app/globals.css`'s `.dark` token *values* change; every component keeps using existing token classes (`bg-card`, `text-destructive`, `border-warning`, etc.).
- `Task.priority` is a plain optional `boolean` — no levels, no new color language. Every UI surface that shows it (the `TaskItem` badge, the `TaskDetailFields` toggle) uses one neutral treatment (matching the existing repeat-cadence pill's `bg-muted`/`text-muted-foreground` styling) — never `bg-brand`/gold and never `border-destructive`/red, since those are already owned by the overdue/pending highlight.
- The same-day overdue/pending highlight only applies when the viewed `date` equals `todayKey()` — never for a past or future day. It reuses `TaskItem`'s existing `highlight?: "overdue" | "pending"` prop; no new visual language.
- `use-drag-to-schedule.ts` is not modified — its gesture logic is untouched by this plan.
- `TaskDetailPanel` keeps working exactly as it does today (still used by `WeeklyView`, unmodified in behavior) — it only gains one new required prop (`onPriorityChange`) threaded through mechanically, matching every other handler prop it already has.
- No changes to the Weekly, Monthly, or Yearly tabs, or to the shared header/`ViewSwitcher`/`task-calendar.tsx` chrome.
- Test conventions (matching this codebase's existing Daily-tab test files exactly): `fakeRepository`/`makeTask` from `test-utils.tsx`, `TasksProvider` wrapping every render that touches the store, fake timers pinned via `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(new Date(2026, 6, 16, 14, 5))` (Thu 2026-07-16 14:05) wherever "today" or "now" matters. This codebase does **not** use `@testing-library/jest-dom` — use `.getAttribute("aria-pressed")`/`.className` string checks, never `toHaveAttribute`.

---

### Task 1: Data model — `Task.priority`, `normalizeTask`, `setPriority` store action

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/data/repository.test.ts`
- Test: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Produces: `Task.priority?: boolean` (types.ts); `normalizeTask` now also coerces a malformed `priority` to `undefined` (repository.ts); `TasksContextValue.setPriority(id: string, priority: boolean): void` (store.tsx), implemented identically to `setMemo`/`setTime`. Consumed by Task 4 (`TaskDetailFields`), Task 5 (`TaskItem`'s `taskItemHandlers`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/data/repository.test.ts`, add these two `it` blocks at the end of the `describe("v2 field normalization", ...)` block (after the `repeatSourceId` tests, before the closing `});`):

```ts
  it("round-trips a valid priority flag", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const prioritized: Task = { ...task, id: "prioritized", priority: true };
    await repo.create(prioritized);
    expect(await repo.list()).toEqual([prioritized]);
  });

  it("clears a non-boolean priority but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, priority: "yes" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.priority).toBeUndefined();
  });
```

In the same file, update the existing `"normalizeTask returns the same reference when nothing changed"` test's `clean` object to also carry a priority value, so the reference-equality fast path is verified with the new field present too:

```ts
  it("normalizeTask returns the same reference when nothing changed", () => {
    const clean: Task = {
      ...task,
      id: "clean",
      time: "09:30",
      subtasks: [{ id: "s1", title: "ok", done: false }],
      repeatWeekdays: [0, 6],
      priority: true,
    };
    expect(normalizeTask(clean)).toBe(clean);
    const bare: Task = { ...task, id: "bare" };
    expect(normalizeTask(bare)).toBe(bare);
  });
```

In `frontend/src/features/tasks/store.test.tsx`, add this new `describe` block at the end of the file, inside the outer `describe("TasksProvider", ...)` block (after `describe("time and subtask actions", ...)`, before its closing `});`):

```tsx
  describe("priority action", () => {
    it("setPriority sets and clears the flag", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setPriority("a", true));
      expect(result.current.tasks[0].priority).toBe(true);
      await waitFor(() => expect(repo.tasks[0].priority).toBe(true));

      act(() => result.current.setPriority("a", false));
      expect(result.current.tasks[0].priority).toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/data/repository.test.ts src/features/tasks/store.test.tsx`
Expected: FAIL — `priority` doesn't exist on `Task`, `normalizeTask` doesn't normalize it, and `setPriority` doesn't exist on the store's context value (TypeScript errors surface as test failures).

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/types.ts`, add the field to the `Task` interface right after `repeatSourceId`:

```ts
  repeatSourceId?: string;   // set only on a task generated from an anchor
  priority?: boolean;
```

In `frontend/src/features/tasks/data/repository.ts`, inside `normalizeTask`, add priority coercion right before the existing `if (time === task.time && ...)` reference-equality check, and extend that check and the returned object:

```ts
  let priority = task.priority;
  if (priority !== undefined && typeof priority !== "boolean") {
    priority = undefined;
  }

  if (
    time === task.time &&
    subtasks === task.subtasks &&
    repeatWeekdays === task.repeatWeekdays &&
    repeatSourceId === task.repeatSourceId &&
    priority === task.priority
  ) {
    return task;
  }
  return { ...task, time, subtasks, repeatWeekdays, repeatSourceId, priority };
```

In `frontend/src/features/tasks/store.tsx`, add to the `TasksContextValue` interface, right after `setRepeatWeekdays`:

```ts
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  setPriority: (id: string, priority: boolean) => void;
```

And add the implementation inside the `useMemo<TasksContextValue>` object, right after the `setRepeatWeekdays(id, weekdays) { ... }` method:

```ts
      setPriority(id, priority) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, priority };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/data/repository.test.ts src/features/tasks/store.test.tsx`
Expected: PASS, both files green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add a lightweight Task.priority flag to the data layer"
```

---

### Task 2: Nudge the dark theme toward Neural Noir

**Files:**
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces: the same dark-mode token *names* with adjusted values — no new tokens, no light-theme change. Affects every component that already uses these tokens (app-wide dark mode), not just Daily.

- [ ] **Step 1: Replace the `.dark` block**

In `frontend/src/app/globals.css`, replace the entire `.dark { ... }` block (currently lines 46–82) with:

```css
.dark {
  color-scheme: dark;
  --background: #0a0b0c;
  --foreground: #f4f5f6;
  --card: #121518;
  --card-foreground: #f4f5f6;
  --popover: #121518;
  --popover-foreground: #f4f5f6;
  --primary: #f4f5f6;
  --primary-foreground: #0a0b0c;
  --secondary: #181c20;
  --secondary-foreground: #f4f5f6;
  --muted: #181c20;
  --muted-foreground: #a3adb7;
  --accent: #181c20;
  --accent-foreground: #f4f5f6;
  --destructive: #ff8a7a;
  --warning: #fbbf24;
  --border: rgb(255 255 255 / 9%);
  --input: #181c20;
  --ring: #d4a85f;
  --brand: #d4a85f;
  --subtle: #697681;
  --chart-1: #6f9cc4;
  --chart-2: #a6afb5;
  --chart-3: #7b858c;
  --chart-4: #4a5258;
  --chart-5: #22272b;
  --sidebar: #121518;
  --sidebar-foreground: #f4f5f6;
  --sidebar-primary: #f4f5f6;
  --sidebar-primary-foreground: #0a0b0c;
  --sidebar-accent: #181c20;
  --sidebar-accent-foreground: #f4f5f6;
  --sidebar-border: rgb(255 255 255 / 9%);
  --sidebar-ring: #d4a85f;
}
```

Note what stayed the same on purpose: `--destructive` and `--warning` are unchanged (they already carry the overdue/pending semantics this plan reuses in Tasks 7–8); `--chart-*` values are unchanged (unused by anything this plan touches, out of scope). The light theme (`:root`) is not touched at all.

- [ ] **Step 2: Verify the build still compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no CSS errors). This is a pure value change — no new class names, so nothing else needs updating for this step to be complete, though every dark-mode screenshot in the app will now look different (expected, and covered by the manual verification pass at the end of this plan).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat: nudge the dark theme toward the Neural Noir palette"
```

---

### Task 3: `lib/times.ts` — `isPastToday`

**Files:**
- Modify: `frontend/src/features/tasks/lib/times.ts`
- Test: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Produces: `isPastToday(time: string, date: string, today: string, nowTime: string): boolean` — true only when `date === today && time < nowTime` (string comparison on `"HH:MM"`, matching this file's existing time-string conventions). Pure function, takes "now" as an argument rather than reading the clock — no fake-timer setup needed in its own tests. Consumed by Task 7 (`DayAgenda`) and Task 8 (`DayTimeline`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/lib/times.test.ts`, add `isPastToday` to the existing import list (alphabetical, matching the file's existing style):

```ts
import {
  compareTasksForDay,
  dayTasksForWeek,
  isPastToday,
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

Add this `describe` block at the end of the file:

```ts
describe("isPastToday", () => {
  it("is true when the date is today and the time has already passed", () => {
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "14:05")).toBe(true);
  });

  it("is false when the date is today but the time hasn't arrived yet", () => {
    expect(isPastToday("15:00", "2026-07-16", "2026-07-16", "14:05")).toBe(false);
  });

  it("is false when the date isn't today, regardless of time", () => {
    expect(isPastToday("09:00", "2026-07-15", "2026-07-16", "14:05")).toBe(false);
    expect(isPastToday("09:00", "2026-07-17", "2026-07-16", "14:05")).toBe(false);
  });

  it("is false at the exact current minute (not past yet)", () => {
    expect(isPastToday("14:05", "2026-07-16", "2026-07-16", "14:05")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: FAIL — `isPastToday` is not exported from `./times`.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/lib/times.ts`, add this function at the end of the file:

```ts
export function isPastToday(
  time: string,
  date: string,
  today: string,
  nowTime: string,
): boolean {
  return date === today && time < nowTime;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/times.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: add isPastToday for same-day, time-of-day overdue comparisons"
```

---

### Task 4: `TaskDetailFields` — priority toggle

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`

**Interfaces:**
- Consumes: `Task.priority` (Task 1).
- Produces: `TaskDetailFields` gains a new **required** prop `onPriorityChange: (priority: boolean) => void`, and renders a toggle button (`role="button"`, accessible name `"Priority"`, `aria-pressed` reflecting `task.priority`) between the repeat block and the memo textarea. This is a required prop (not optional) — every existing caller of `TaskDetailFields` must be updated to pass it; that update happens in Task 5 (`TaskItem`, `TaskDetailPanel`) and Task 6 (`TaskDetailDrawer`, new). Consumed by Task 5 and Task 6.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, update the `noopHandlers` object at the top of the file to include the new handler:

```ts
const noopHandlers = {
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};
```

Add this new `describe` block at the end of the file:

```ts
describe("TaskDetailFields priority", () => {
  it("shows the priority toggle unpressed for a non-priority task", () => {
    render(<TaskDetailFields task={makeTask({})} {...noopHandlers} />);
    expect(
      screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the priority toggle pressed for a priority task", () => {
    render(<TaskDetailFields task={makeTask({ priority: true })} {...noopHandlers} />);
    expect(
      screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("calls onPriorityChange with the toggled value", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ priority: false })}
        {...noopHandlers}
        onPriorityChange={onPriorityChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });

  it("toggles off when already priority", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ priority: true })}
        {...noopHandlers}
        onPriorityChange={onPriorityChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: FAIL — no element with accessible name "Priority" exists yet, and `onPriorityChange` isn't a recognized prop (TypeScript error).

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/task-detail-fields.tsx`, replace the whole file:

```tsx
"use client";

import { RotateCw, Star } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskRepeatPicker } from "./task-repeat-picker";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  showTime = true,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
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
      {(task.repeatWeekdays !== undefined || task.scope.kind === "day") &&
        (task.repeatSourceId !== undefined ? (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <RotateCw aria-label="Part of a routine" className="size-3" />
            Part of a routine
          </span>
        ) : (
          <TaskRepeatPicker
            weekdays={task.repeatWeekdays ?? []}
            onChange={onRepeatWeekdaysChange}
          />
        ))}
      <button
        type="button"
        onClick={() => onPriorityChange(!task.priority)}
        aria-pressed={!!task.priority}
        className={cn(
          "flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
          task.priority
            ? "bg-muted text-foreground"
            : "bg-transparent text-subtle hover:bg-muted/50",
        )}
      >
        <Star className={cn("size-3", task.priority && "fill-current")} />
        Priority
      </button>
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

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS, entire file green.

- [ ] **Step 5: Run the full suite to check for expected breakage**

Run: `cd frontend && npx vitest run`
Expected: `primitives.test.tsx` and `task-detail-panel.test.tsx` now fail — both render `TaskDetailFields` (via `TaskItem`'s inline expansion, and directly) without the new required `onPriorityChange` prop. This is expected and fixed in Task 5. Confirm the *only* new failures are in those two files, and `task-detail-fields.test.tsx` itself is green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx
git commit -m "feat: add a priority toggle to TaskDetailFields"
```

---

### Task 5: `TaskItem` + `TaskDetailPanel` — priority badge and end-to-end wiring

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-panel.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `Task.priority` (Task 1), `TaskDetailFields`'s new `onPriorityChange` prop (Task 4).
- Produces: `TaskItem` renders a "Priority" badge (same visual treatment as the repeat-cadence pill) when `task.priority` is true, and gains a new **required** prop `onPriorityChange: (priority: boolean) => void`, threaded to its inline `TaskDetailFields` expansion. `taskItemHandlers` (and the `TaskItemActions` interface it takes) gains `onPriorityChange`/`setPriority`, so every existing caller that spreads `{...taskItemHandlers(id, actions)}` (`ScopeTasks`, `DayTimeline`, `DayAgenda`, `WeeklyView`, `year-grid.tsx`) automatically satisfies `TaskItem`'s new required prop with no changes to those files. `TaskDetailPanel` gains the same required prop, threaded through to its own `TaskDetailFields` call. Consumed by Task 6 (`TaskDetailDrawer`), Task 7 (`DayAgenda`), Task 8 (`DayTimeline`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, update the `noopHandlers` object at the top of the file:

```ts
const noopHandlers = {
  onToggle: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};
```

Add these three `it` blocks inside the existing `describe("TaskItem v2", ...)` block, right after the `"renders a repeat cadence pill when repeatLabel is set"` test:

```ts
  it("renders a Priority badge when task.priority is true", () => {
    render(
      <TaskItem task={makeTask({ title: "gym", priority: true })} {...noopHandlers} />,
    );
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("renders no Priority badge when task.priority is false or unset", () => {
    render(<TaskItem task={makeTask({ title: "gym" })} {...noopHandlers} />);
    expect(screen.queryByText("Priority")).toBeNull();
  });

  it("threads onPriorityChange to the inline TaskDetailFields expansion", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist" })}
        {...noopHandlers}
        onPriorityChange={onPriorityChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });
```

In `frontend/src/features/tasks/components/task-detail-panel.test.tsx`, update the `noopHandlers` object at the top of the file:

```ts
const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};
```

Add this `it` block at the end of the `describe("TaskDetailPanel", ...)` block:

```ts
  it("threads onPriorityChange through to TaskDetailFields", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailPanel task={task} {...noopHandlers} onPriorityChange={onPriorityChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx src/features/tasks/components/task-detail-panel.test.tsx`
Expected: FAIL — `onPriorityChange` isn't a recognized prop on either component yet, so no "Priority" badge/button exists and the mocks are never called.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/task-item.tsx`, update the `TaskItemActions` interface and `taskItemHandlers`:

```ts
interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  setPriority: (id: string, priority: boolean) => void;
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
    onPriorityChange: (priority: boolean) => actions.setPriority(id, priority),
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}
```

Update the `TaskItem` function's props destructuring and type:

```tsx
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
  onPriorityChange,
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
  onPriorityChange: (priority: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onSelect?: () => void;
}) {
```

Add the priority badge, right after the `repeatLabel` badge block and before the `rolledFrom` icon:

```tsx
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
        {task.priority && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-xs" : "px-1 text-[10px]",
            )}
          >
            Priority
          </span>
        )}
        {task.rolledFrom && (
```

Update the inline `TaskDetailFields` call in the `open &&` expansion block to thread the new prop:

```tsx
      {open && (
        <div className="mt-1 pl-6">
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
            onPriorityChange={onPriorityChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
        </div>
      )}
```

In `frontend/src/features/tasks/components/task-detail-panel.tsx`, update the props destructuring, type, and the `TaskDetailFields` call:

```tsx
export function TaskDetailPanel({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
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
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
```

```tsx
      <TaskDetailFields
        task={task}
        onMemoChange={onMemoChange}
        onTimeChange={onTimeChange}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        onPriorityChange={onPriorityChange}
        onDelete={onDelete}
        onAddSubtask={onAddSubtask}
        onToggleSubtask={onToggleSubtask}
        onRemoveSubtask={onRemoveSubtask}
        showTime={false}
      />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/primitives.test.tsx src/features/tasks/components/task-detail-panel.test.tsx`
Expected: PASS, both files entirely green.

- [ ] **Step 5: Run the full suite to confirm no other breakage**

Run: `cd frontend && npx vitest run`
Expected: every test file green (this confirms `ScopeTasks`, `DayTimeline`, `DayAgenda`, `WeeklyView`, and `year-grid.tsx` — none of which are modified in this task — still work correctly purely because `taskItemHandlers` now supplies `onPriorityChange` automatically via their existing `{...taskItemHandlers(...)}` spreads).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/task-detail-panel.tsx frontend/src/features/tasks/components/primitives.test.tsx frontend/src/features/tasks/components/task-detail-panel.test.tsx
git commit -m "feat: show a Priority badge on TaskItem and wire the toggle end-to-end"
```

---

### Task 6: New `TaskDetailDrawer` component

**Files:**
- Create: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

**Interfaces:**
- Consumes: `TaskDetailFields` (with its `onPriorityChange` prop, Task 4); `TaskTimeEditor` (existing, unchanged); `Checkbox` from `@/components/ui/checkbox` (existing, unchanged).
- Produces: `TaskDetailDrawer({ task, onToggle, onClose, onMemoChange, onTimeChange, onRepeatWeekdaysChange, onPriorityChange, onDelete, onAddSubtask, onToggleSubtask, onRemoveSubtask })` — same prop shape as `TaskDetailPanel`, different chrome: a `fixed inset-y-0 right-0` overlay (`data-testid="task-detail-drawer"`) instead of an in-place block, with the same header (checkbox, title, time editor, close button, `aria-label="Close details"`) and body (`TaskDetailFields` with `showTime={false}`) as `TaskDetailPanel`, plus an `Escape`-key listener that calls `onClose`. Consumed by Task 9 (`DailyView`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailDrawer } from "./task-detail-drawer";

const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailDrawer", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("shows the task's checkbox, title, and memo", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByText("write tests")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value,
    ).toBe("with care");
  });

  it("renders as a fixed-position overlay, not swapped inline", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByTestId("task-detail-drawer").className).toContain("fixed");
  });

  it("calls onToggle from the header checkbox", () => {
    const onToggle = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("removes its Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onDelete from the delete button", () => {
    const onDelete = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows a time input in the header and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task time")).toHaveLength(1);
  });

  it("calls onPriorityChange from the priority toggle", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailDrawer task={task} {...noopHandlers} onPriorityChange={onPriorityChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: FAIL — `./task-detail-drawer` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/features/tasks/components/task-detail-drawer.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
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
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      data-testid="task-detail-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col gap-1.5 border-l border-border bg-card p-4 shadow-2xl"
    >
      <div className="flex items-center gap-2" data-testid="task-detail-header">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskDetailFields
          task={task}
          onMemoChange={onMemoChange}
          onTimeChange={onTimeChange}
          onRepeatWeekdaysChange={onRepeatWeekdaysChange}
          onPriorityChange={onPriorityChange}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
          showTime={false}
        />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx
git commit -m "feat: add TaskDetailDrawer, a slide-in overlay detail view"
```

---

### Task 7: `DayAgenda` — three sections and same-day overdue highlighting

**Files:**
- Modify: `frontend/src/features/tasks/components/day-agenda.tsx`
- Test: `frontend/src/features/tasks/components/day-agenda.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `isPastToday` (Task 3); `todayKey` from `../lib/dates` (existing); `TaskItem`'s `highlight` prop (existing) and automatic priority badge (Task 5, no `DayAgenda` code needed for it).
- Produces: `DayAgenda`'s props are unchanged (`date`, `onSelectTask`, `agendaZoneRef`, `getDragHandlers`) — only its internal rendering changes. It now renders up to three labeled sections in order — **All Day To-Do** (untimed, undone), **Next Up** (timed, undone, sorted ascending by time), **Done Today** (every done task, dimmed) — each omitted entirely when empty, with one `QuickAdd` pinned at the bottom spanning all three. `Next Up` cards get `highlight="overdue"`/`"pending"` via `isPastToday`, but only when `date === todayKey()`. Consumed by Task 9 (`DailyView`, no interface change needed there).

- [ ] **Step 1: Write the failing tests (full file rewrite)**

Replace the entire contents of `frontend/src/features/tasks/components/day-agenda.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgenda } from "./day-agenda";

const ANCHOR = "2026-07-16"; // Thursday; "today" under the pinned clock below

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

describe("DayAgenda sections", () => {
  it("shows a quick-add pinned at the bottom", async () => {
    renderAgenda(ANCHOR);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
  });

  it("puts an untimed, undone task under All Day To-Do", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.queryByText("Done Today")).toBeNull();
  });

  it("puts a timed, undone task under Next Up, sorted by time", async () => {
    const later = makeTask({
      id: "l",
      title: "later",
      time: "16:00",
      scope: { kind: "day", date: ANCHOR },
    });
    const earlier = makeTask({
      id: "e",
      title: "earlier",
      time: "15:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [later, earlier]);
    await waitFor(() => expect(screen.getByText("earlier")).toBeTruthy());
    expect(screen.getByText("Next Up")).toBeTruthy();
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("earlier");
    expect(items[1]).toContain("later");
  });

  it("puts a done task under Done Today regardless of timed/untimed", async () => {
    const doneTimed = makeTask({
      id: "dt",
      title: "done timed",
      time: "09:00",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    const doneUntimed = makeTask({
      id: "du",
      title: "done untimed",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [doneTimed, doneUntimed]);
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy());
    expect(screen.queryByText("All Day To-Do")).toBeNull();
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.getByText("done timed")).toBeTruthy();
    expect(screen.getByText("done untimed")).toBeTruthy();
  });

  it("hides a section entirely when it has no tasks", async () => {
    const t = makeTask({ id: "u", title: "only task", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("only task")).toBeTruthy());
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.queryByText("Done Today")).toBeNull();
  });

  it("excludes tasks from a different day", async () => {
    const other = makeTask({ id: "o", title: "other day", scope: { kind: "day", date: "2026-07-17" } });
    renderAgenda(ANCHOR, [other]);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("other day")).toBeNull();
  });

  it("renders each task as a large-size card", async () => {
    const t = makeTask({ id: "t", title: "big card", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("big card")).toBeTruthy());
    expect(screen.getByRole("button", { name: "big card" }).className).toContain("text-2xl");
  });

  it("calls onSelectTask instead of expanding inline when a card's title is clicked", async () => {
    const t = makeTask({ id: "t", title: "select me", scope: { kind: "day", date: ANCHOR } });
    const onSelectTask = vi.fn();
    renderAgenda(ANCHOR, [t], onSelectTask);
    await waitFor(() => expect(screen.getByText("select me")).toBeTruthy());
    fireEvent.click(screen.getByText("select me"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });

  it("adds a day-scoped task via the bottom quick-add", async () => {
    renderAgenda(ANCHOR);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "new task" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("new task")).toBeTruthy());
  });
});

describe("DayAgenda same-day overdue highlighting", () => {
  it("marks a past-time undone task overdue when viewing today", async () => {
    const t = makeTask({
      id: "t",
      title: "morning meeting",
      time: "09:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("morning meeting")).toBeTruthy());
    const row = screen.getByText("morning meeting").closest("div");
    expect(row?.className).toContain("border-destructive");
  });

  it("marks a future-time undone task pending when viewing today", async () => {
    const t = makeTask({
      id: "t",
      title: "afternoon call",
      time: "16:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("afternoon call")).toBeTruthy());
    const row = screen.getByText("afternoon call").closest("div");
    expect(row?.className).toContain("border-warning");
  });

  it("does not highlight timed tasks when viewing a day other than today", async () => {
    const other = "2026-07-17";
    const t = makeTask({
      id: "t",
      title: "tomorrow's task",
      time: "09:00",
      scope: { kind: "day", date: other },
    });
    renderAgenda(other, [t]);
    await waitFor(() => expect(screen.getByText("tomorrow's task")).toBeTruthy());
    const row = screen.getByText("tomorrow's task").closest("div");
    expect(row?.className).not.toContain("border-destructive");
    expect(row?.className).not.toContain("border-warning");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: FAIL — the current `DayAgenda` renders one flat "All day" list with no section labels and no overdue/pending highlighting.

- [ ] **Step 3: Implement — replace the entire contents of `day-agenda.tsx`**

```tsx
"use client";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, isPastToday, nowTime } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
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
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);

  const allDayToDo = dayTasks.filter((t) => !t.time && !t.done);
  const nextUp = [...dayTasks.filter((t) => !!t.time && !t.done)].sort(compareTasksForDay);
  const doneToday = dayTasks.filter((t) => t.done);

  const today = todayKey();
  const isViewingToday = date === today;
  const currentTime = nowTime();

  function renderCard(t: Task, highlight?: "overdue" | "pending") {
    return (
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
            highlight={highlight}
            {...taskItemHandlers(t.id, actions)}
            onSelect={onSelectTask && (() => onSelectTask(t.id))}
          />
        </ul>
      </div>
    );
  }

  return (
    <div ref={agendaZoneRef} data-testid="day-agenda" className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {allDayToDo.length > 0 && (
          <section>
            <div className="mb-1 shrink-0 text-xs font-semibold">All Day To-Do</div>
            <div className="space-y-2">{allDayToDo.map((t) => renderCard(t))}</div>
          </section>
        )}
        {nextUp.length > 0 && (
          <section>
            <div className="mb-1 shrink-0 text-xs font-semibold">Next Up</div>
            <div className="space-y-2">
              {nextUp.map((t) =>
                renderCard(
                  t,
                  isViewingToday
                    ? isPastToday(t.time!, date, today, currentTime)
                      ? "overdue"
                      : "pending"
                    : undefined,
                ),
              )}
            </div>
          </section>
        )}
        {doneToday.length > 0 && (
          <section className="opacity-60">
            <div className="mb-1 shrink-0 text-xs font-semibold">Done Today</div>
            <div className="space-y-2">{doneToday.map((t) => renderCard(t))}</div>
          </section>
        )}
      </div>
      <QuickAdd onAdd={(title) => addTask(title, scope)} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full suite to check for expected breakage**

Run: `cd frontend && npx vitest run`
Expected: `daily-view.test.tsx` now shows some failures (it asserts against the old single-list "All day" label and other now-removed structure) — this is expected and fixed in Task 9. Confirm the *only* new failures are in `daily-view.test.tsx`, and `day-agenda.test.tsx` plus every other file are green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-agenda.test.tsx
git commit -m "feat: split DayAgenda into All Day To-Do / Next Up / Done Today sections"
```

---

### Task 8: `DayTimeline` — same-day overdue highlighting on rail chips

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx`
- Test: `frontend/src/features/tasks/components/day-timeline.test.tsx`

**Interfaces:**
- Consumes: `isPastToday` (Task 3); `TaskItem`'s `highlight` prop (existing).
- Produces: no prop-shape change to `DayTimeline` — each rail chip now gets the same `highlight="overdue"`/`"pending"` computation `DayAgenda` uses (Task 7), so the same task looks consistent in both places. Only applies when `date === todayKey()`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, add this new `describe` block at the end of the file:

```tsx
describe("DayTimeline same-day overdue highlighting", () => {
  it("marks a past-time undone chip overdue when viewing today", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "morning meeting",
      time: "09:00",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    const row = screen.getByText("morning meeting").closest("div");
    expect(row?.className).toContain("border-destructive");
  });

  it("marks a future-time undone chip pending when viewing today", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "afternoon call",
      time: "16:00",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    const row = screen.getByText("afternoon call").closest("div");
    expect(row?.className).toContain("border-warning");
  });

  it("does not highlight a chip when viewing a non-today date", async () => {
    const other = "2026-07-15";
    const t = makeTask({
      id: "t",
      title: "yesterday's task",
      time: "09:00",
      scope: { kind: "day", date: other },
    });
    renderTimeline(other, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    const row = screen.getByText("yesterday's task").closest("div");
    expect(row?.className).not.toContain("border-destructive");
    expect(row?.className).not.toContain("border-warning");
  });

  it("does not highlight a done chip even past its time", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "done early task",
      time: "09:00",
      done: true,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    const row = screen.getByText("done early task").closest("div");
    expect(row?.className).not.toContain("border-destructive");
    expect(row?.className).not.toContain("border-warning");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-timeline.test.tsx -t "overdue"`
Expected: FAIL — rail chips don't compute or pass any `highlight` yet.

- [ ] **Step 3: Implement**

In `frontend/src/features/tasks/components/day-timeline.tsx`, update the imports:

```tsx
import { todayKey } from "../lib/dates";
import { compareTasksForDay, isPastToday, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
```

Update the body of `DayTimeline` to compute `today`/`currentTime` once and reuse `currentTime` for the now-line (replacing the existing `nowTime()` call there), and to compute each chip's highlight:

```tsx
  const actions = useTasks();
  const { tasks } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const timed = tasks.filter((t) => scopeKey(t.scope) === key && t.time).sort(compareTasksForDay);
  const today = todayKey();
  const isToday = date === today;
  const currentTime = nowTime();
```

```tsx
        {isToday && (
          <div
            data-testid="now-line"
            className="absolute inset-x-0 z-10 border-t-2 border-brand"
            style={{ top: toOffset(currentTime) }}
          />
        )}

        {layoutTimedTasks(timed).map(({ task: t, column, columns }) => {
          const highlight =
            isToday && !t.done
              ? isPastToday(t.time!, date, today, currentTime)
                ? "overdue"
                : "pending"
              : undefined;
          return (
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
                  highlight={highlight}
                  {...taskItemHandlers(t.id, actions)}
                  onSelect={onSelectTask && (() => onSelectTask(t.id))}
                />
              </ul>
            </div>
          );
        })}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS, all tests in the file green (both the new `"overdue"` block and every pre-existing test, since the now-line's rendered value is unchanged — only its source variable changed from `nowTime()` to the cached `currentTime`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: apply same-day overdue/pending highlighting to timeline chips"
```

---

### Task 9: `DailyView` — 60/40 layout and the drawer overlay

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx`
- Test: `frontend/src/features/tasks/components/views/daily-view.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `TaskDetailDrawer` (Task 6, replaces `TaskDetailPanel` + `ShrinkStack` for this view only); `DayAgenda`/`DayTimeline` (Tasks 7–8, prop shapes unchanged).
- Produces: `DailyView`'s own props (`CalendarViewProps`) are unchanged. Internally: the two columns render at a 60/40 ratio (`grid-cols-[3fr_2fr]`) and always at full size (no more `ShrinkStack`/conditional swap); the drawer renders as a sibling overlay, alongside the existing drag-ghost overlay, when a task is selected.

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

describe("DailyView v4 (60/40 layout, drawer overlay)", () => {
  it("renders no neighboring-day cells", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the timeline and agenda side by side, one quick-add total", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByTestId("day-agenda")).toBeTruthy();
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });

  it("shows a timed task both as a rail chip and as an agenda card", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
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

describe("DailyView task detail drawer", () => {
  it("opens the drawer for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // agenda only

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getAllByText("task a")).toHaveLength(2); // agenda card + drawer header

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // drawer swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the drawer when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the drawer on Escape", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the drawer", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("renders the drawer as a fixed overlay while both columns stay full-size", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    expect(screen.getByTestId("task-detail-drawer").className).toContain("fixed");
    expect(screen.getByTestId("hour-rail")).toBeTruthy();
    expect(screen.getByTestId("day-agenda")).toBeTruthy();
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
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
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
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
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

Note: several fixture times changed from `"09:30"`/`"09:00"` to `"16:00"` versus the prior version of this file — under the pinned clock (14:05), `"09:30"`/`"09:00"` are now in the past and would render with `highlight="overdue"` (Task 8), which is irrelevant noise for tests that aren't about highlighting; using a future time (`"16:00"`) keeps those tests focused on what they actually assert. The drag-to-schedule tests keep their original times since those assert on the resulting chip position, not on highlight classes.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — the current `DailyView` still uses `ShrinkStack`/`TaskDetailPanel` and a 50/50 grid, has no `task-detail-drawer` testid, and doesn't close on Escape.

- [ ] **Step 3: Implement — replace the entire contents of `daily-view.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";

import { useTasks } from "../../store";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { TaskDetailDrawer } from "../task-detail-drawer";
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

  return (
    <>
      <div className="grid h-full grid-cols-[3fr_2fr] gap-1.5">
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
          <DayAgenda
            date={anchor}
            onSelectTask={handleSelectTask}
            agendaZoneRef={agendaZoneRef}
            getDragHandlers={getDragHandlers}
          />
        </div>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}

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
Expected: every test file green.

- [ ] **Step 6: Lint and typecheck**

Run: `cd frontend && npm run lint`
Expected: no errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.tsx frontend/src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: rework DailyView to a 60/40 layout with a slide-in detail drawer"
```

---

## Manual verification (after all tasks)

Run `cd frontend && npm run dev`, switch to dark mode, open the app on the Daily tab, and check:

1. The whole app's dark mode now reads as near-black surfaces with a warm gold accent (brand/ring color) instead of the previous steel-blue — check this on the Weekly/Monthly/Yearly tabs too, since the token change is app-wide. Light mode is unaffected.
2. Daily tab: the timeline (left) is visibly wider than the agenda (right) — roughly 60/40, not 50/50.
3. The right column shows up to three labeled sections — "All Day To-Do", "Next Up", "Done Today" — each appearing only when it has tasks. Untimed tasks appear under "All Day To-Do", timed unfinished tasks under "Next Up" sorted by time, completed tasks (dimmed) under "Done Today".
4. Add a task for today with a time in the past (e.g. earlier this morning) — confirm it shows red-bordered ("overdue") in both the rail chip and the "Next Up" card.
5. Add a task for today with a time later than now — confirm it's amber-bordered ("pending") in both places, not red.
6. Navigate to a different day (yesterday or tomorrow) — confirm timed tasks there show no overdue/pending highlight at all, regardless of their time.
7. Open a task's detail via the Priority toggle inside its expansion (or via the drawer) — mark it priority, confirm a neutral "Priority" badge appears on its card/chip; unmark it, confirm the badge disappears.
8. Click a task in the agenda — confirm a drawer slides in from the right edge, overlaying the page, while both columns stay the same size behind it. Press Escape — confirm it closes. Click the same task again — confirm it also closes. Click a different task while the drawer is open — confirm it swaps to that task.
9. Confirm drag-to-schedule still works both directions (agenda card → rail sets a time; rail chip → agenda clears it).
10. Go to the Weekly tab, open a task's detail there — confirm it still uses the original in-place panel (not a drawer) and still has a working Priority toggle.
