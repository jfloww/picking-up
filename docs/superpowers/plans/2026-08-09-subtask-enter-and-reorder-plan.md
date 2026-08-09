# Subtask Enter-to-Close and Drag Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two subtask UX features to the frontend: Enter in the Subtask
Detail panel's title field commits the edit and closes the panel, and
subtasks in the Drawer variant of the subtask list can be reordered via a
drag handle.

**Architecture:** Both features are frontend-only — subtasks are a JSON
array embedded directly on `Task` (`backend/apps/tasks/models.py:89`), so
array position already *is* the order, and every subtask edit already
round-trips through a full-Task PATCH guarded by `Task.version`. Reordering
reuses the existing `useDragToReorder` pointer-drag hook (already used for
top-level task reordering in `day-agenda.tsx`/`scope-tasks.tsx`) rather
than building new drag logic, and persists through a new store action
(`reorderSubtask`) that follows the exact same shape as the existing
`addSubtask`/`toggleSubtask`/`removeSubtask` actions.

**Tech Stack:** Next.js/React, TypeScript, Vitest + Testing Library
(`fireEvent`, `renderHook`), the existing `useDragToReorder` hook.

## Global Constraints

- No backend changes — confirmed unnecessary; see spec
  (`docs/superpowers/specs/2026-08-09-subtask-enter-and-reorder-design.md`).
- Reordering applies only to the Drawer variant of the subtask list
  (`DrawerSubtaskRow` in `subtask-list.tsx`). The plain/inline variant
  (`PlainSubtaskRow`, used only from `task-item.tsx`) is untouched.
- Only active (not-done) subtasks are reorderable — matches the existing
  top-level task-reorder precedent (`day-agenda.tsx`'s `allDayToDo`
  excludes done tasks the same way).
- Follow established codebase patterns exactly rather than inventing new
  ones: the `<li ref>` → `HTMLDivElement` cast pattern from
  `scope-tasks.tsx` (not widening `useDragToReorder`'s generic type), the
  `GripVertical` icon from `lucide-react` already used for task reordering,
  and the existing `taskItemHandlers`/spread-props wiring convention.

---

### Task 1: Subtask Detail panel — Enter commits and closes

**Files:**
- Modify: `frontend/src/features/tasks/components/subtask-detail-panel.tsx:113-120`
- Test: `frontend/src/features/tasks/components/subtask-detail-panel.test.tsx`

**Interfaces:**
- Consumes: nothing new — `onClose: () => void` already exists as a prop
  (line 33), already wired to the close button's `onClick` (line 100).
- Produces: nothing consumed by later tasks — fully independent of Task 2/3.

- [ ] **Step 1: Write the failing test**

Add to `subtask-detail-panel.test.tsx`, after the existing "commits a
changed title via onTitleChange on Enter" test (around line 64):

```tsx
  it("also calls onClose after committing via Enter", () => {
    const onTitleChange = vi.fn();
    const onClose = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={onClose}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.change(input, { target: { value: "buy pine wood" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitleChange).toHaveBeenCalledWith("buy pine wood");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={onClose}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run subtask-detail-panel.test.tsx`
Expected: FAIL on "also calls onClose after committing via Enter" —
`onClose` was not called (the Escape test passes already, since Escape
never called `onClose` even before this change).

- [ ] **Step 3: Implement**

In `subtask-detail-panel.tsx`, modify the `onKeyDown` handler (lines
113-120):

```tsx
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // A title is a single logical line even once it wraps onto
              // several visual ones — Enter commits it, same as the old
              // single-line <input>, instead of inserting a newline. It
              // also closes the panel — pressing Enter here reads as "I'm
              // done with this subtask," distinct from Escape's "cancel,
              // stay open."
              e.preventDefault();
              commitTitle();
              onClose();
            }
```

(The rest of the handler — the `Escape` branch — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run subtask-detail-panel.test.tsx`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/features/tasks/components/subtask-detail-panel.tsx src/features/tasks/components/subtask-detail-panel.test.tsx
git commit -m "feat: close the Subtask Detail panel when Enter commits the title"
```

---

### Task 2: Store action — `reorderSubtask`

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: `Task`/`Subtask` types (`./types`), `persistUpdate(task: Task)`
  (already defined in `store.tsx:424`), `tasksRef.current` (already used by
  every sibling subtask action).
- Produces: `reorderSubtask(id: string, subtaskId: string, insertBeforeId: string | null): void`
  on `TasksContextValue` — this is the exact signature Task 3's
  `taskItemHandlers` wiring depends on.

- [ ] **Step 1: Write the failing tests**

Add to `store.test.tsx`, inside the `describe("time and subtask actions", ...)`
block (after the "toggleSubtask flips one subtask; removeSubtask deletes
it" test, around line 774):

```tsx
    it("reorderSubtask moves a subtask to a new position among siblings", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        subtasks: [
          { id: "s1", title: "one", done: false },
          { id: "s2", title: "two", done: false },
          { id: "s3", title: "three", done: false },
        ],
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.reorderSubtask("a", "s1", "s3"));
      expect(result.current.tasks[0].subtasks?.map((s) => s.id)).toEqual([
        "s2",
        "s1",
        "s3",
      ]);
      await waitFor(() =>
        expect(repo.tasks[0].subtasks?.map((s) => s.id)).toEqual(["s2", "s1", "s3"]),
      );
    });

    it("reorderSubtask with a null insertBeforeId moves it to the end", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        subtasks: [
          { id: "s1", title: "one", done: false },
          { id: "s2", title: "two", done: false },
          { id: "s3", title: "three", done: false },
        ],
      });
      const { result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.reorderSubtask("a", "s1", null));
      expect(result.current.tasks[0].subtasks?.map((s) => s.id)).toEqual([
        "s2",
        "s3",
        "s1",
      ]);
    });

    it("reorderSubtask is a no-op (and does not persist) when dropped in its current position", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        subtasks: [
          { id: "s1", title: "one", done: false },
          { id: "s2", title: "two", done: false },
          { id: "s3", title: "three", done: false },
        ],
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const updateSpy = vi.spyOn(repo, "update");

      // s1 is already immediately before s2 — inserting it before s2 again
      // is a no-op.
      act(() => result.current.reorderSubtask("a", "s1", "s2"));
      expect(result.current.tasks[0].subtasks?.map((s) => s.id)).toEqual([
        "s1",
        "s2",
        "s3",
      ]);
      expect(updateSpy).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run store.test.tsx -t "reorderSubtask"`
Expected: FAIL with a TypeScript error / `result.current.reorderSubtask is
not a function` — the action doesn't exist yet.

- [ ] **Step 3: Implement**

In `store.tsx`, add to the `TasksContextValue` interface (after
`removeSubtask` at line 260):

```ts
  reorderSubtask: (id: string, subtaskId: string, insertBeforeId: string | null) => void;
```

Then add the action implementation, after `removeSubtask` (after line 933,
before `editSubtaskTitle`):

```ts
      reorderSubtask(id, subtaskId, insertBeforeId) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const subtasks = current.subtasks;
        const currentIndex = subtasks.findIndex((s) => s.id === subtaskId);
        if (currentIndex === -1) return;
        const moving = subtasks[currentIndex];
        const remaining = subtasks.filter((s) => s.id !== subtaskId);
        const targetIndex =
          insertBeforeId === null
            ? remaining.length
            : remaining.findIndex((s) => s.id === insertBeforeId);
        if (targetIndex === -1) return;
        // Compare list *positions*, not just the two ids: after removing
        // the dragged subtask to build `remaining`, the slot it already
        // occupies is targetIndex === currentIndex in that shifted index
        // space — same no-op check as day-agenda.tsx's task-level
        // handleReorder, adapted here since subtasks have no separate
        // command endpoint of their own to skip calling.
        if (targetIndex === currentIndex) return;
        const reordered = [...remaining];
        reordered.splice(targetIndex, 0, moving);
        const task: Task = { ...current, subtasks: reordered };
        persistUpdate(task);
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run store.test.tsx -t "reorderSubtask"`
Expected: PASS, all three new tests.

- [ ] **Step 5: Run the full store test file to check for regressions**

Run: `cd frontend && npx vitest run store.test.tsx`
Expected: PASS, all tests (including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx
git commit -m "feat: add reorderSubtask store action"
```

---

### Task 3: Wire the reorder prop through the component tree and build the drag UI

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/subtask-list.tsx`
- Create: `frontend/src/features/tasks/components/subtask-list.test.tsx`

**Interfaces:**
- Consumes: `reorderSubtask` from Task 2 (`actions.reorderSubtask(id, subtaskId, insertBeforeId)`),
  `useDragToReorder` (existing, `./use-drag-to-reorder.ts` — `containerRef`,
  `itemRefs`, `orderedIds`, `onReorder` in; `{ dragState, getDragHandlers }`
  out, where `getDragHandlers(id: string, title: string)` returns
  `{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }`,
  each a React event handler).
- Produces: `onReorderSubtask: (subtaskId: string, insertBeforeId: string | null) => void`
  threaded as: `taskItemHandlers()` → `TaskDetailDrawer` prop (required) →
  `TaskDetailFields` prop (optional) → `SubtaskList` prop `onReorder`
  (optional) → `DrawerSubtaskList` → `DrawerSubtaskRow`.

This task has no isolated failing-test step of its own for the plumbing
(steps 3a-3c below) — those files have no independent behavior to test
until the UI in step 3d exists and calls through them. Tests are written
first for the end-to-end UI behavior (step 1), then all the wiring is
implemented together (steps 3a-3d) before running them.

Note on test scope vs. the spec: the spec's Testing section calls for
mirroring `use-drag-to-reorder.test.tsx`'s full coverage (drag past a
sibling, drag outside the container cancels, a sub-threshold drag is a
no-op). Only the "drag past a sibling" case is repeated below — the
cancel/no-op-threshold behaviors are the hook's own internal logic,
already exhaustively covered in `use-drag-to-reorder.test.tsx`, and
`subtask-list.tsx` doesn't change or wrap that logic at all (it only wires
ids/callbacks into the hook). Re-testing those same outcomes through this
extra layer would duplicate coverage without checking anything new; the
one drag test below exists specifically to confirm the *wiring* (correct
subtask ids reach `onReorder`), which is the only thing actually new here.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/subtask-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Subtask } from "../types";
import { SubtaskList } from "./subtask-list";

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

const subtasks: Subtask[] = [
  { id: "s1", title: "one", done: false },
  { id: "s2", title: "two", done: false },
  { id: "s3", title: "three", done: false },
];

describe("SubtaskList (drawer variant) reordering", () => {
  it("renders a reorder handle for each subtask when onReorder is provided", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    expect(screen.getByLabelText("Reorder one")).toBeInTheDocument();
    expect(screen.getByLabelText("Reorder two")).toBeInTheDocument();
    expect(screen.getByLabelText("Reorder three")).toBeInTheDocument();
  });

  it("does not render a reorder handle when onReorder is omitted", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        drawer
      />,
    );
    expect(screen.queryByLabelText("Reorder one")).not.toBeInTheDocument();
  });

  it("does not render a reorder handle for a completed subtask", () => {
    render(
      <SubtaskList
        subtasks={[
          { id: "s1", title: "one", done: true },
          { id: "s2", title: "two", done: false },
        ]}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    expect(screen.queryByLabelText("Reorder one")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reorder two")).toBeInTheDocument();
  });

  it("dragging a handle past a sibling calls onReorder with the subtask id and the sibling to insert before", () => {
    const onReorder = vi.fn();
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={onReorder}
        drawer
      />,
    );
    // The container's own rect must be mocked too — useDragToReorder
    // checks the pointer against it to decide "inside vs. outside the
    // list" (see use-drag-to-reorder.ts's resolve()), and JSDOM's default
    // zero-sized rect for an unmocked element would make every drag below
    // clientY=0 register as "outside," so onReorder would never fire and
    // this test would fail for the wrong reason.
    mockRect(screen.getByTestId("drawer-subtask-list"), {
      top: 0,
      bottom: 120,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle one").closest("li")!, {
      top: 0,
      bottom: 40,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle two").closest("li")!, {
      top: 40,
      bottom: 80,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle three").closest("li")!, {
      top: 80,
      bottom: 120,
      left: 0,
      right: 200,
    });

    const handle = screen.getByLabelText("Reorder one");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 90 }); // upper half of "three" (80-120)
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 90 });

    expect(onReorder).toHaveBeenCalledWith("s1", "s3");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run subtask-list.test.tsx`
Expected: FAIL — either a TypeScript error (`onReorder` isn't a known prop
on `SubtaskList` yet) or, if it runs anyway, `getByLabelText("Reorder
one")` throwing "Unable to find an element."

- [ ] **Step 3a: Wire `task-item.tsx`**

Add to the `TaskItemActions` interface (after `removeSubtask` at line 33):

```ts
  reorderSubtask: (id: string, subtaskId: string, insertBeforeId: string | null) => void;
```

Add to `taskItemHandlers()`'s returned object (after `onRemoveSubtask` at
line 85):

```ts
    onReorderSubtask: (subtaskId: string, insertBeforeId: string | null) =>
      actions.reorderSubtask(id, subtaskId, insertBeforeId),
```

Do **not** add `onReorderSubtask` to `TaskItem`'s own props or JSX —
`TaskItem` (the plain/default variant) already omits several
drawer-only keys from this same spread (`onPromoteSubtask`,
`onEditSubtaskTitle`, `onEditSubtaskMemo`) for the same reason: reordering
is Drawer-variant-only.

In `task-item.test.tsx`, update the hand-constructed actions object inside
the `"undoing a promotion..."` test (around line 167-186) — add after
`removeSubtask: () => {},` (line 180):

```ts
      reorderSubtask: () => {},
```

- [ ] **Step 3b: Wire `task-detail-drawer.tsx`**

Add to the destructured props (after `onRemoveSubtask` at line 68):

```ts
  onReorderSubtask,
```

Add to the props type (after `onRemoveSubtask: (subtaskId: string) => void;`
at line 91):

```ts
  onReorderSubtask: (subtaskId: string, insertBeforeId: string | null) => void;
```

Pass it through to `TaskDetailFields` (after `onRemoveSubtask={onRemoveSubtask}`
at line 284):

```tsx
          onReorderSubtask={onReorderSubtask}
```

In `task-detail-drawer.test.tsx`, add to the `noopHandlers` object (after
`onRemoveSubtask: (_id: string) => {},` at line 21):

```ts
  onReorderSubtask: (_id: string, _insertBeforeId: string | null) => {},
```

- [ ] **Step 3c: Wire `task-detail-fields.tsx`**

Add to the destructured props (after `onRemoveSubtask` at line 29):

```ts
  onReorderSubtask,
```

Add to the props type (after `onRemoveSubtask: (subtaskId: string) => void;`
at line 52) — optional, since this component also serves the plain variant
which never provides it:

```ts
  onReorderSubtask?: (subtaskId: string, insertBeforeId: string | null) => void;
```

Pass it through to `SubtaskList` (after `onRemove={onRemoveSubtask}` at
line 179):

```tsx
        onReorder={onReorderSubtask}
```

No changes needed to `task-detail-fields.test.tsx` — this prop is optional,
so existing render calls that omit it keep compiling and passing
unchanged. Confirm this in Step 4 rather than assuming it.

- [ ] **Step 3d: Build the drag UI in `subtask-list.tsx`**

Update the imports at the top of the file:

```tsx
"use client";

import { ArrowUpRight, GripVertical, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";
import { useDragToReorder } from "./use-drag-to-reorder";
import {
  prefersReducedMotion,
  SUBTASK_TRANSITION_DURATION_MS,
  useSubtaskTransitionClasses,
  type SubtaskRenderState,
} from "./use-subtask-transition-classes";

// Handle-bag type derived from the hook itself (not hand-duplicated) so it
// can't drift if useDragToReorder's return shape ever changes.
type ReorderHandlers = ReturnType<ReturnType<typeof useDragToReorder>["getDragHandlers"]>;
```

Replace the whole `DrawerSubtaskRow` function with:

```tsx
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onOpen,
  onPromote,
  animationClass,
  reorderable = false,
  getReorderHandlers,
  itemRef,
  showDropIndicatorAbove = false,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpen?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  animationClass?: string;
  reorderable?: boolean;
  getReorderHandlers?: (id: string, title: string) => ReorderHandlers;
  itemRef?: (el: HTMLLIElement | null) => void;
  showDropIndicatorAbove?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleRemove = () => {
    if (prefersReducedMotion()) {
      onRemove(subtask.id);
      return;
    }
    setDeleting(true);
    setTimeout(() => onRemove(subtask.id), SUBTASK_TRANSITION_DURATION_MS);
  };

  return (
    <li
      ref={itemRef}
      className={cn(
        // border-t-2 border-transparent is the baseline (not just added
        // when active) so toggling the drop indicator never changes the
        // row's box height — box-sizing: border-box (Tailwind's preflight)
        // means this border eats into the existing h-10 box, not adds to it.
        "group flex h-10 items-center gap-2.5 rounded-md border-t-2 border-transparent px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40",
        showDropIndicatorAbove && "border-brand",
        deleting ? "animate-subtask-exit" : animationClass,
      )}
    >
      {reorderable && getReorderHandlers && (
        <button
          type="button"
          aria-label={`Reorder ${subtask.title}`}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle outline-none transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
          {...getReorderHandlers(subtask.id, subtask.title)}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      <Checkbox
        checked={subtask.done}
        onCheckedChange={() => onToggle(subtask.id)}
        aria-label={`Toggle ${subtask.title}`}
        className="shrink-0 border-subtle"
      />
      <button
        type="button"
        onClick={() => onOpen?.(subtask.id)}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          subtask.done && "text-muted-foreground line-through hover:text-muted-foreground",
        )}
      >
        {subtask.title}
      </button>
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
        onClick={handleRemove}
        aria-label={`Delete ${subtask.title}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}
```

Replace the whole `DrawerSubtaskList` function with:

```tsx
function DrawerSubtaskList({
  subtasks,
  renderStates,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
  onReorder,
}: {
  subtasks: Subtask[];
  renderStates: Map<string, SubtaskRenderState>;
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  onReorder?: (subtaskId: string, insertBeforeId: string | null) => void;
}) {
  const withRenderState = subtasks.map((s) => ({
    subtask: s,
    state: renderStates.get(s.id),
  }));
  // Grouping uses the (possibly delayed) render-state `done` value, not the
  // live one, so a just-toggled row stays in its old section for the
  // duration of its exit animation instead of jumping to the new section
  // on the very next render.
  const active = withRenderState.filter((x) => !(x.state?.done ?? x.subtask.done));
  const completed = withRenderState.filter((x) => x.state?.done ?? x.subtask.done);

  const reorderContainerRef = useRef<HTMLDivElement | null>(null);
  const reorderItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Only active subtasks are reorderable, matching the existing top-level
  // task reorder's scope (day-agenda.tsx's allDayToDo excludes done tasks
  // the same way) — dragging a completed subtask back into order isn't
  // supported here.
  const { dragState: reorderDragState, getDragHandlers: getReorderHandlers } = useDragToReorder({
    containerRef: reorderContainerRef,
    itemRefs: reorderItemRefs,
    orderedIds: active.map(({ subtask: s }) => s.id),
    onReorder: (id, insertBeforeId) => onReorder?.(id, insertBeforeId),
  });

  return (
    <div className="space-y-1">
      {(active.length > 0 || completed.length > 0) && (
        <div ref={reorderContainerRef} data-testid="drawer-subtask-list">
          <ul>
            {[...active, ...completed].map(({ subtask: s, state }) => {
              const isActive = !(state?.done ?? s.done);
              const reorderable = !!onReorder && isActive;
              return (
                <DrawerSubtaskRow
                  key={s.id}
                  subtask={s}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onOpen={onOpenSubtask}
                  onPromote={onPromote}
                  animationClass={state?.enterAnimationClass ?? state?.sectionAnimationClass}
                  reorderable={reorderable}
                  getReorderHandlers={reorderable ? getReorderHandlers : undefined}
                  itemRef={
                    reorderable
                      ? (el) => {
                          // itemRefs is typed for HTMLDivElement (matching
                          // useDragToReorder's interface), but subtask rows
                          // are <li>; the hook only calls
                          // getBoundingClientRect() on it, which every
                          // HTMLElement supports, so this cast is safe (same
                          // pattern as scope-tasks.tsx's task rows).
                          reorderItemRefs.current[s.id] = el as unknown as HTMLDivElement | null;
                        }
                      : undefined
                  }
                  showDropIndicatorAbove={
                    reorderable &&
                    !!reorderDragState?.insideList &&
                    reorderDragState.insertBeforeId === s.id
                  }
                />
              );
            })}
          </ul>
        </div>
      )}
      <div className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 text-foreground/70 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
        <Plus
          className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-within:text-amber"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <QuickAdd onAdd={onAdd} placeholder="Add a subtask" />
        </div>
      </div>
    </div>
  );
}
```

Update `SubtaskList`'s signature and its `drawer` branch (leave the plain
non-drawer branch below it completely unchanged):

```tsx
export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
  onReorder,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  onReorder?: (subtaskId: string, insertBeforeId: string | null) => void;
  drawer?: boolean;
}) {
  const renderStates = useSubtaskTransitionClasses(subtasks);

  if (drawer) {
    return (
      <DrawerSubtaskList
        subtasks={subtasks}
        renderStates={renderStates}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
        onOpenSubtask={onOpenSubtask}
        onPromote={onPromote}
        onReorder={onReorder}
      />
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run subtask-list.test.tsx task-item.test.tsx task-detail-drawer.test.tsx task-detail-fields.test.tsx`
Expected: PASS, all tests in all four files — this also confirms Step 3c's
claim that `task-detail-fields.test.tsx` needs no changes.

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

Run: `cd frontend && npm test`
Expected: PASS, no regressions anywhere else in the app (this catches any
other consumer of `TaskItemActions`, `taskItemHandlers`, or the modified
components not already covered above).

- [ ] **Step 6: Manual verification**

Run: `cd frontend && npm run dev`, open a task with 3+ subtasks in the
Task Detail drawer, and confirm:
- A grip handle appears to the left of each active subtask's checkbox.
- No handle appears on a completed subtask.
- Dragging a handle up/down past a sibling shows a highlighted top border
  on the row it would land above, and dropping there reorders the list.
- The reordered order survives a page reload (confirms the PATCH actually
  persisted, not just local state).

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/features/tasks/components/task-item.tsx src/features/tasks/components/task-item.test.tsx src/features/tasks/components/task-detail-drawer.tsx src/features/tasks/components/task-detail-drawer.test.tsx src/features/tasks/components/task-detail-fields.tsx src/features/tasks/components/subtask-list.tsx src/features/tasks/components/subtask-list.test.tsx
git commit -m "feat: drag-to-reorder subtasks in the Task Detail drawer"
```
