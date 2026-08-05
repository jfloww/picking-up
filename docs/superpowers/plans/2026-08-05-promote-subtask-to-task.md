# Promote a Subtask Back to a Main Task — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hover/focus-revealed action on each subtask row in the task detail drawer immediately promotes that subtask into a new standalone task in the parent's scope, with an Undo toast afterward.

**Architecture:** One new store action (`promoteSubtaskToTask`, data layer), one new small toast component (`PromoteUndoToast`), a new icon button threaded through the existing `SubtaskList`/`DrawerSubtaskRow` component chain, and wiring into `TaskDetailDrawer` — the single component already shared by all four views (Daily, Weekly, Monthly, Bucket List), so no per-view changes are needed. Undo reuses the existing `convertTaskToSubtask` action from the drag-to-nest feature.

**Tech Stack:** Next.js/React 19 (existing), Vitest + `@testing-library/react` (existing) — no new dependencies.

## Global Constraints

- Lives entirely in `TaskDetailDrawer` and its existing child chain — no per-view (`daily-view.tsx`/`weekly-view.tsx`/etc.) changes beyond what `taskItemHandlers` already threads through automatically.
- No blocking/eligibility cases — promoting a subtask can never fail on data grounds, unlike the nest feature.
- Immediate action, no confirmation — Undo instead.
- The promote icon only appears in the drawer variant of the subtask list (`DrawerSubtaskRow`), not the compact non-drawer `SubtaskList` used elsewhere (e.g. `TaskItem`'s inline expandable editor).
- No backend changes.

---

### Task 1: `promoteSubtaskToTask` store action

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Produces: `promoteSubtaskToTask(id: string, subtaskId: string): Task | undefined` on `TasksContextValue` and the actions object. Task 4 threads this through `TaskItemActions`/`taskItemHandlers` in `task-item.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/store.test.tsx`, inside the existing `describe("time and subtask actions", ...)` block (after the `convertTaskToSubtask` tests added by the drag-to-nest feature):

```tsx
    it("promoteSubtaskToTask creates a standalone task in the parent's scope, preserving done state, and removes the subtask", async () => {
      const parent = makeTask({
        id: "p",
        title: "plan trip",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "s1", title: "book flights", done: true }],
      });
      const { repo, result } = setup(fakeRepository([parent]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      let created: ReturnType<typeof result.current.promoteSubtaskToTask>;
      act(() => {
        created = result.current.promoteSubtaskToTask("p", "s1");
      });

      expect(created?.title).toBe("book flights");
      expect(created?.done).toBe(true);
      expect(created?.scope).toEqual({ kind: "day", date: todayKey() });
      expect(result.current.tasks.find((t) => t.id === "p")?.subtasks).toEqual([]);
      expect(result.current.tasks.some((t) => t.id === created?.id)).toBe(true);
      await waitFor(() => expect(repo.tasks.some((t) => t.id === created?.id)).toBe(true));
      await waitFor(() => expect(repo.tasks.find((t) => t.id === "p")?.subtasks).toEqual([]));
    });

    it("promoteSubtaskToTask inserts directly after an untimed parent (All Day To-Do)", async () => {
      const parent = makeTask({
        id: "p",
        title: "plan trip",
        scope: { kind: "day", date: todayKey() },
        order: 1,
        subtasks: [{ id: "s1", title: "book flights", done: false }],
      });
      const sibling = makeTask({
        id: "sib",
        title: "later item",
        scope: { kind: "day", date: todayKey() },
        order: 2,
      });
      const { result } = setup(fakeRepository([parent, sibling]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      let created: ReturnType<typeof result.current.promoteSubtaskToTask>;
      act(() => {
        created = result.current.promoteSubtaskToTask("p", "s1");
      });

      expect(created!.order).toBeGreaterThan(1);
      expect(created!.order).toBeLessThan(2);
    });

    it("promoteSubtaskToTask appends to the end of All Day To-Do when the parent is timed", async () => {
      const parent = makeTask({
        id: "p",
        title: "meeting",
        scope: { kind: "day", date: todayKey() },
        time: "09:00",
        subtasks: [{ id: "s1", title: "prep notes", done: false }],
      });
      const existing = makeTask({
        id: "e",
        title: "existing all-day item",
        scope: { kind: "day", date: todayKey() },
        order: 3,
      });
      const { result } = setup(fakeRepository([parent, existing]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      let created: ReturnType<typeof result.current.promoteSubtaskToTask>;
      act(() => {
        created = result.current.promoteSubtaskToTask("p", "s1");
      });

      expect(created!.order).toBe(4);
    });

    it("promoteSubtaskToTask defaults to order 0 for a bucket-scoped parent", async () => {
      const parent = makeTask({
        id: "p",
        title: "someday",
        scope: { kind: "bucket", categoryId: "cat-1" },
        subtasks: [{ id: "s1", title: "research", done: false }],
      });
      const { result } = setup(fakeRepository([parent]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      let created: ReturnType<typeof result.current.promoteSubtaskToTask>;
      act(() => {
        created = result.current.promoteSubtaskToTask("p", "s1");
      });

      expect(created!.order).toBe(0);
      expect(created!.scope).toEqual({ kind: "bucket", categoryId: "cat-1" });
    });

    it("promoteSubtaskToTask is a no-op when the parent or subtask isn't found", async () => {
      const parent = makeTask({
        id: "p",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "s1", title: "x", done: false }],
      });
      const { result } = setup(fakeRepository([parent]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      let a: ReturnType<typeof result.current.promoteSubtaskToTask>;
      let b: ReturnType<typeof result.current.promoteSubtaskToTask>;
      act(() => {
        a = result.current.promoteSubtaskToTask("missing", "s1");
        b = result.current.promoteSubtaskToTask("p", "missing");
      });

      expect(a).toBeUndefined();
      expect(b).toBeUndefined();
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0].subtasks).toHaveLength(1);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx -t "promoteSubtaskToTask"`
Expected: FAIL — `result.current.promoteSubtaskToTask is not a function`.

- [ ] **Step 3: Add the import**

In `frontend/src/features/tasks/store.tsx`, add to the existing `./lib/*` imports near the top:

```ts
import { computeOrderBetween } from "./lib/reorder";
```

- [ ] **Step 4: Add `promoteSubtaskToTask` to the `TasksContextValue` interface**

Directly after the `convertTaskToSubtask` line added by the drag-to-nest feature:

```ts
  convertTaskToSubtask: (id: string, targetId: string) => void;
  promoteSubtaskToTask: (id: string, subtaskId: string) => Task | undefined;
```

- [ ] **Step 5: Implement the action**

Add directly after `editSubtaskTitle`'s implementation and before `convertTaskToSubtask`'s (or after it — either position is fine, keep it adjacent to the other subtask actions):

```ts
      promoteSubtaskToTask(id, subtaskId) {
        const parent = state.tasks.find((t) => t.id === id);
        if (!parent?.subtasks) return undefined;
        const subtask = parent.subtasks.find((s) => s.id === subtaskId);
        if (!subtask) return undefined;

        const scope = parent.scope;
        let order: number;
        if (scope.kind === "day" && !parent.time) {
          // Parent lives in All Day To-Do — insert the promoted task
          // directly after it.
          const nextSibling = state.tasks
            .filter(
              (t) =>
                t.scope.kind === "day" &&
                t.scope.date === scope.date &&
                !t.time &&
                !t.done &&
                t.order > parent.order,
            )
            .sort((a, b) => a.order - b.order)[0];
          order = computeOrderBetween(parent.order, nextSibling?.order);
        } else if (scope.kind === "day") {
          // Parent is timed (Next Up) — the promoted task is always
          // untimed regardless, so there's no natural sibling to land
          // next to; append to the end of All Day To-Do for that day,
          // same as addTask's own default for a fresh untimed task.
          order =
            Math.max(
              0,
              ...state.tasks
                .filter(
                  (t) => t.scope.kind === "day" && t.scope.date === scope.date && !t.time && !t.done,
                )
                .map((t) => t.order),
            ) + 1;
        } else {
          order = 0;
        }

        const task: Task = {
          id: crypto.randomUUID(),
          title: subtask.title,
          done: subtask.done,
          scope: parent.scope,
          order,
          createdAt: new Date().toISOString(),
        };
        const updatedParent: Task = {
          ...parent,
          subtasks: parent.subtasks.filter((s) => s.id !== subtaskId),
        };

        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);

        dispatch({ type: "updated", task: updatedParent });
        repo.update(updatedParent).catch(handleSyncFailure);

        return task;
      },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (every test in the file, including the 5 new ones)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add promoteSubtaskToTask action"
```

---

### Task 2: `PromoteUndoToast` component

**Files:**
- Create: `frontend/src/features/tasks/components/promote-undo-toast.tsx`
- Create: `frontend/src/features/tasks/components/promote-undo-toast.test.tsx`

**Interfaces:**
- Produces: `PromoteUndoToast({ title, onUndo, onDismiss })`. Task 4 renders this conditionally in `TaskDetailDrawer`, keyed by the promoted task's id (see Task 4's rationale for why).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/promote-undo-toast.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromoteUndoToast } from "./promote-undo-toast";

describe("PromoteUndoToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the moved task's title", () => {
    render(<PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/buy milk/)).toBeTruthy();
  });

  it("calls onUndo when Undo is clicked", () => {
    const onUndo = vi.fn();
    render(<PromoteUndoToast title="buy milk" onUndo={onUndo} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss automatically after 6 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clears the timer on unmount (no dismiss call after unmount)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={onDismiss} />,
    );
    unmount();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/promote-undo-toast.test.tsx`
Expected: FAIL — cannot find module `./promote-undo-toast`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/features/tasks/components/promote-undo-toast.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function PromoteUndoToast({
  title,
  onUndo,
  onDismiss,
}: {
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  // Runs once per mount, not on every re-render: the parent remounts this
  // component (via a `key` on the promoted task's id — see TaskDetailDrawer)
  // each time a new promotion happens, so a mount-only timer is exactly "6
  // seconds after this toast appeared." Including onDismiss/onUndo in the
  // deps array would restart the timer on every unrelated parent re-render
  // instead (e.g. the user typing elsewhere in the drawer), since inline
  // arrow functions are a new reference every render.
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
        <span className="text-foreground">Moved &ldquo;{title}&rdquo; out as its own task.</span>
        <button type="button" onClick={onUndo} className="font-medium text-brand hover:underline">
          Undo
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/promote-undo-toast.test.tsx`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/promote-undo-toast.tsx frontend/src/features/tasks/components/promote-undo-toast.test.tsx
git commit -m "feat: add PromoteUndoToast component"
```

---

### Task 3: Promote icon in `DrawerSubtaskRow` + prop threading

**Files:**
- Modify: `frontend/src/features/tasks/components/subtask-list.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`

**Interfaces:**
- Produces: `SubtaskList`'s exported props gain `onPromote?: (subtaskId: string) => void;` (mirroring the existing short-name convention of `onAdd`/`onToggle`/`onRemove`/`onEditTitle` — `TaskDetailFields` is what renames it to `onPromoteSubtask` when calling down, matching how it already renames the other four). `TaskDetailFields`'s exported props gain `onPromoteSubtask?: (subtaskId: string) => void;`. Task 4 supplies this from `TaskDetailDrawer`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, in a new `describe` block after the existing subtask-related tests (search the file for its subtask `describe` block and add this one immediately after):

```tsx
describe("TaskDetailFields promote subtask", () => {
  it("shows a promote icon per subtask in drawer variant when onPromoteSubtask is provided, and calls it with the subtask id", () => {
    const onPromoteSubtask = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ subtasks: [{ id: "s1", title: "book flights", done: false }] })}
        {...noopHandlers}
        variant="drawer"
        onPromoteSubtask={onPromoteSubtask}
      />,
    );
    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
    expect(onPromoteSubtask).toHaveBeenCalledWith("s1");
  });

  it("does not show a promote icon when onPromoteSubtask is not provided", () => {
    render(
      <TaskDetailFields
        task={makeTask({ subtasks: [{ id: "s1", title: "book flights", done: false }] })}
        {...noopHandlers}
        variant="drawer"
      />,
    );
    expect(screen.queryByLabelText("Move book flights out as its own task")).toBeNull();
  });

  it("does not show a promote icon in the non-drawer (default) variant, even when onPromoteSubtask is provided", () => {
    const onPromoteSubtask = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ subtasks: [{ id: "s1", title: "book flights", done: false }] })}
        {...noopHandlers}
        onPromoteSubtask={onPromoteSubtask}
      />,
    );
    expect(screen.queryByLabelText("Move book flights out as its own task")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx -t "promote subtask"`
Expected: FAIL — `screen.getByLabelText("Move book flights out as its own task")` finds nothing (TypeScript will also flag the unknown `onPromoteSubtask` prop once the prop type is added in Step 4 below and reverted — at this point before any implementation, the prop doesn't exist yet on `TaskDetailFields`, so this is a compile-time gap too, not just a runtime one).

- [ ] **Step 3: Update `subtask-list.tsx`**

In `frontend/src/features/tasks/components/subtask-list.tsx`, update the lucide import:

```tsx
import { ArrowUpRight, Plus, X } from "lucide-react";
```

Update `DrawerSubtaskRow`'s props to add `onPromote`:

```tsx
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
```

Add the promote button directly before the existing delete button (currently the last child of the `<li>`, right after the `editing ? ... : ...` block):

```tsx
      {onPromote && (
        <button
          type="button"
          onClick={() => onPromote(subtask.id)}
          aria-label={`Move ${subtask.title} out as its own task`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(subtask.id)}
        aria-label={`Delete ${subtask.title}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3.5" />
      </button>
```

Update `DrawerSubtaskList`'s props and pass-through:

```tsx
function DrawerSubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
```

```tsx
            <DrawerSubtaskRow
              key={s.id}
              subtask={s}
              onToggle={onToggle}
              onRemove={onRemove}
              onEditTitle={onEditTitle}
              onPromote={onPromote}
            />
```

Update `SubtaskList`'s exported props and its `drawer` branch's pass-through:

```tsx
export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
  drawer?: boolean;
}) {
  if (drawer) {
    return (
      <DrawerSubtaskList
        subtasks={subtasks}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
        onEditTitle={onEditTitle}
        onPromote={onPromote}
      />
    );
  }
```

(The non-drawer branch below is untouched — no promote button there, per the plan's global constraints.)

- [ ] **Step 4: Update `task-detail-fields.tsx`**

Add `onPromoteSubtask` to the props (directly after `onEditSubtaskTitle` in both the destructuring and the type block):

```tsx
  onEditSubtaskTitle,
  onPromoteSubtask,
```

```tsx
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  onPromoteSubtask?: (subtaskId: string) => void;
```

Update the `<SubtaskList>` call inside `subtasksSection` to pass it through:

```tsx
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
        onEditTitle={onEditSubtaskTitle}
        onPromote={onPromoteSubtask}
        drawer={drawer}
      />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS (every test in the file, including the 3 new ones)

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — `subtask-list.tsx` has no dedicated test file (its behavior is exercised through `task-detail-fields.test.tsx`/`task-detail-drawer.test.tsx`, matching this codebase's existing convention), so this confirms nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/subtask-list.tsx frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx
git commit -m "feat: add promote-to-task icon to drawer subtask rows"
```

---

### Task 4: Wire into `TaskDetailDrawer` and `taskItemHandlers`

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

**Interfaces:**
- Consumes: Task 1's `promoteSubtaskToTask` and the existing `convertTaskToSubtask` (from the drag-to-nest feature) via the store; Task 2's `PromoteUndoToast`; Task 3's `TaskDetailFields`'s `onPromoteSubtask` prop.
- Produces: `taskItemHandlers(id, actions)` gains `onPromoteSubtask: (subtaskId: string) => Task | undefined` and `onUndoPromoteSubtask: (taskId: string) => void` — both automatically threaded into every view that already spreads `taskItemHandlers(...)` onto `TaskDetailDrawer` (Daily, Weekly, Monthly, Bucket List), with no per-view file changes required.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`, add the two new required props to the shared `noopHandlers` object (directly after `onEditSubtaskTitle`):

```tsx
  onEditSubtaskTitle: (_id: string, _title: string) => {},
  onPromoteSubtask: (_subtaskId: string) => undefined,
  onUndoPromoteSubtask: (_taskId: string) => {},
```

Append a new `describe` block at the end of the file:

```tsx
describe("TaskDetailDrawer promote subtask to task", () => {
  it("clicking the promote icon converts the subtask and shows an undo toast naming the promoted task", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    render(<TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));

    expect(onPromoteSubtask).toHaveBeenCalledWith("s1");
    expect(screen.getByText(/book flights/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("clicking Undo calls onUndoPromoteSubtask with the promoted task's id", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    const onUndoPromoteSubtask = vi.fn();
    render(
      <TaskDetailDrawer
        task={task}
        {...noopHandlers}
        onPromoteSubtask={onPromoteSubtask}
        onUndoPromoteSubtask={onUndoPromoteSubtask}
      />,
    );

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onUndoPromoteSubtask).toHaveBeenCalledWith("new-task");
  });

  it("does not show a toast when promotion fails (onPromoteSubtask returns undefined)", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi.fn().mockReturnValue(undefined);
    render(<TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("resets the toast when the drawer switches to a different task", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const otherTask = makeTask({ id: "b", title: "other task" });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    const { rerender } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />,
    );

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();

    rerender(<TaskDetailDrawer task={otherTask} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx -t "promote subtask to task"`
Expected: FAIL — `TaskDetailDrawer` doesn't accept `onPromoteSubtask`/`onUndoPromoteSubtask` yet, and doesn't render a promote icon or toast.

- [ ] **Step 3: Update `task-item.tsx`**

Add to the `TaskItemActions` interface, directly after `editSubtaskTitle`:

```ts
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  promoteSubtaskToTask: (id: string, subtaskId: string) => Task | undefined;
  convertTaskToSubtask: (id: string, targetId: string) => void;
```

Add to `taskItemHandlers`'s returned object, directly after `onEditSubtaskTitle`:

```ts
    onEditSubtaskTitle: (subtaskId: string, title: string) =>
      actions.editSubtaskTitle(id, subtaskId, title),
    onPromoteSubtask: (subtaskId: string) => actions.promoteSubtaskToTask(id, subtaskId),
    onUndoPromoteSubtask: (taskId: string) => actions.convertTaskToSubtask(taskId, id),
```

- [ ] **Step 4: Update `task-detail-drawer.tsx`**

Add the two new props (directly after `onEditSubtaskTitle` in both the destructuring and the type block):

```tsx
  onEditSubtaskTitle,
  onPromoteSubtask,
  onUndoPromoteSubtask,
```

```tsx
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  onPromoteSubtask: (subtaskId: string) => Task | undefined;
  onUndoPromoteSubtask: (taskId: string) => void;
```

Import `PromoteUndoToast`:

```tsx
import { PromoteUndoToast } from "./promote-undo-toast";
```

Add state, directly after the existing `const [confirmingDelete, setConfirmingDelete] = useState(false);` line:

```tsx
  const [promoteToast, setPromoteToast] = useState<{ title: string; taskId: string } | null>(null);
```

Reset it on task switch — add one line to the existing `useEffect`:

```tsx
  useEffect(() => {
    setDraft(draftFromTask(task, bucketCategories));
    setConfirmingDelete(false);
    setPromoteToast(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);
```

Add the handler, directly after `handleDone`:

```tsx
  function handlePromoteSubtask(subtaskId: string) {
    const created = onPromoteSubtask(subtaskId);
    if (created) setPromoteToast({ title: created.title, taskId: created.id });
  }
```

Pass `onPromoteSubtask={handlePromoteSubtask}` to `TaskDetailFields` (directly after the existing `onEditSubtaskTitle={onEditSubtaskTitle}` line):

```tsx
          onEditSubtaskTitle={onEditSubtaskTitle}
          onPromoteSubtask={handlePromoteSubtask}
```

Render the toast as the last child inside `<aside>`, directly after `</footer>` and before the closing `</aside>`:

```tsx
      </footer>
      {promoteToast && (
        <PromoteUndoToast
          key={promoteToast.taskId}
          title={promoteToast.title}
          onUndo={() => {
            onUndoPromoteSubtask(promoteToast.taskId);
            setPromoteToast(null);
          }}
          onDismiss={() => setPromoteToast(null)}
        />
      )}
    </aside>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: PASS (every test in the file, including the 4 new ones)

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — confirms every view that spreads `taskItemHandlers(...)` onto `TaskDetailDrawer` (Daily, Weekly, Monthly, Bucket List) still compiles and passes with the two new required props automatically supplied through that spread.

- [ ] **Step 7: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Manual verification in the browser**

Start the dev server (`cd frontend && npm run dev`) and, in any view with a task that has subtasks:
- Open the task's detail drawer, hover (or tab-focus) a subtask row — confirm both the promote and delete icons appear.
- On a touch device or emulated touch, tap the subtask's title to focus within the row and confirm the icons remain reachable without hover.
- Click the promote icon — confirm the subtask disappears from the list, the toast appears naming it, and the underlying task now exists as a standalone item in the same day/bucket the parent belongs to (check by closing the drawer and looking at the agenda/bucket list).
- Click Undo — confirm the toast disappears and the subtask reappears under the original parent.
- Promote another subtask and just wait — confirm the toast auto-dismisses after ~6 seconds without needing Undo.
- Confirm this works identically from Weekly, Monthly, and Bucket List views, not just Daily.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx
git commit -m "feat: wire subtask-to-task promotion into TaskDetailDrawer"
```
