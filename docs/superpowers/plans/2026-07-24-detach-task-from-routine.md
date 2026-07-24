# Detach a Task from Its Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user detach one routine-generated task occurrence into a standalone task, from both the task-detail drawer and the inline expanded row, without deleting it.

**Architecture:** A new `detachFromRoutine(id, weekdays?)` store action clears `repeatSourceId` (and sets `repeatWeekdays` only if new ones are passed). `TaskDetailFields` grows a "Detach" button next to its existing "Part of a routine" label. The inline row (`task-item.tsx`) wires it to commit immediately, matching every other field there. The drawer (`task-detail-drawer.tsx`) buffers it in draft state until Done, then makes one combined call so a simultaneous "detach + pick new weekdays" edit can't be split into two dispatches that clobber each other (see spec's "Why one combined action" section).

**Tech Stack:** Next.js/React, TypeScript, Vitest + Testing Library. All commands below run from `frontend/`.

## Global Constraints

- Detaching clears `repeatSourceId` and does not inherit the anchor's weekdays by default (per spec's approved "plain one-off task" behavior).
- The inline row (`task-item.tsx`) commits Detach immediately, exactly like its other fields (no buffering exists there).
- The drawer buffers Detach until Done; Cancel/X/Escape discard it, matching every other drawer field.
- No changes to `daily-view.tsx` / `weekly-view.tsx` — both already spread `taskItemHandlers(id, actions)` onto `TaskDetailDrawer`, so the new handler reaches it automatically.

---

## Task 1: Store action `detachFromRoutine`

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx:52-65` (interface), `frontend/src/features/tasks/store.tsx:177-184` (implementation, insert after)
- Test: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: nothing new — mirrors the existing `setRepeatWeekdays(id, weekdays)` action already in this file.
- Produces: `detachFromRoutine(id: string, weekdays?: number[]): void` on `TasksContextValue`. Consumed by Task 2 (`TaskDetailFields`'s prop, indirectly) and Task 3/4 (wiring).

- [ ] **Step 1: Write the failing tests**

  In `frontend/src/features/tasks/store.test.tsx`, inside the existing `describe("routines", ...)` block (right after the `"setRepeatWeekdays sets, then clears to undefined when weekdays is empty"` test, before its closing `});` at line 214), add:

  ```tsx
    it("detachFromRoutine clears repeatSourceId, leaving repeatWeekdays unset by default", async () => {
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: todayKey() },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ"));
      expect(result.current.tasks[0].repeatSourceId).toBeUndefined();
      expect(result.current.tasks[0].repeatWeekdays).toBeUndefined();
      await waitFor(() => expect(repo.tasks[0].repeatSourceId).toBeUndefined());
    });

    it("detachFromRoutine sets repeatWeekdays when weekdays are provided", async () => {
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: todayKey() },
        repeatSourceId: "anchor",
      });
      const { result } = setup(fakeRepository([occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ", [2, 4]));
      expect(result.current.tasks[0].repeatSourceId).toBeUndefined();
      expect(result.current.tasks[0].repeatWeekdays).toEqual([2, 4]);
    });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/store.test.tsx`
  Expected: FAIL — `result.current.detachFromRoutine is not a function`.

- [ ] **Step 3: Add the action to the `TasksContextValue` interface**

  In `frontend/src/features/tasks/store.tsx`, in the `TasksContextValue` interface (around line 57), change:

  ```ts
    setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  ```

  to:

  ```ts
    setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
    detachFromRoutine: (id: string, weekdays?: number[]) => void;
  ```

- [ ] **Step 4: Implement the action**

  In the same file, right after the `setRepeatWeekdays` action's implementation (it ends at line 184 with `},`, immediately before `setPriority(id, priority) {` on line 185), insert:

  ```ts
      detachFromRoutine(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = { ...current, repeatSourceId: undefined, repeatWeekdays: normalized };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run src/features/tasks/store.test.tsx`
  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx
  git commit -m "feat: add detachFromRoutine store action"
  ```

---

## Task 2: "Detach" control in `TaskDetailFields`

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx:13-45` (props), `:77-81` (JSX)
- Test: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TaskDetailFields` gains a required `onDetachFromRoutine: () => void` prop, rendered as a "Detach" button next to the existing "Part of a routine" label. Consumed by Task 3 (`TaskItem`) and Task 4 (`TaskDetailDrawer`).

- [ ] **Step 1: Write the failing test**

  In `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, add `onDetachFromRoutine: () => {},` to the `noopHandlers` object (after `onRepeatWeekdaysChange`, around line 10):

  ```ts
  const noopHandlers = {
    onMemoChange: (_memo: string) => {},
    onTimeChange: (_time?: string) => {},
    onRepeatWeekdaysChange: (_weekdays: number[]) => {},
    onDetachFromRoutine: () => {},
    onPriorityChange: (_priority: boolean) => {},
    onDurationChange: (_durationMinutes?: number) => {},
    onBackgroundChange: (_background: boolean) => {},
    onDelete: () => {},
    onAddSubtask: (_title: string) => {},
    onToggleSubtask: (_id: string) => {},
    onRemoveSubtask: (_id: string) => {},
  };
  ```

  Then, inside the `describe("TaskDetailFields repeat", ...)` block, right after the `"shows a read-only indicator instead of the picker for a generated occurrence"` test (after its closing `});` around line 108), add:

  ```tsx
    it("shows a Detach control for a generated occurrence and calls onDetachFromRoutine when clicked", () => {
      const onDetachFromRoutine = vi.fn();
      render(
        <TaskDetailFields
          task={makeTask({
            scope: { kind: "day", date: "2026-07-16" },
            repeatSourceId: "anchor-1",
          })}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
        />,
      );
      fireEvent.click(screen.getByText("Detach"));
      expect(onDetachFromRoutine).toHaveBeenCalledTimes(1);
    });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
  Expected: FAIL — TypeScript error / `onDetachFromRoutine` not a recognized prop, and `screen.getByText("Detach")` finds nothing.

- [ ] **Step 3: Add the prop and render the button**

  In `frontend/src/features/tasks/components/task-detail-fields.tsx`, add `onDetachFromRoutine` to the destructured props (after `onRepeatWeekdaysChange,` around line 17) and to the type (after `onRepeatWeekdaysChange: (weekdays: number[]) => void;` around line 33):

  ```ts
  export function TaskDetailFields({
    task,
    onMemoChange,
    onTimeChange,
    onRepeatWeekdaysChange,
    onDetachFromRoutine,
    onPriorityChange,
    ...
  }: {
    task: Task;
    onMemoChange: (memo: string) => void;
    onTimeChange: (time?: string) => void;
    onRepeatWeekdaysChange: (weekdays: number[]) => void;
    onDetachFromRoutine: () => void;
    onPriorityChange: (priority: boolean) => void;
    ...
  }) {
  ```

  Then replace the "Part of a routine" branch (lines 77-81):

  ```tsx
            {task.repeatSourceId !== undefined ? (
              <span className="flex items-center gap-1 text-xs text-subtle">
                <RotateCw aria-label="Part of a routine" className="size-3" />
                Part of a routine
              </span>
            ) : (
  ```

  with:

  ```tsx
            {task.repeatSourceId !== undefined ? (
              <span className="flex items-center gap-1 text-xs text-subtle">
                <RotateCw aria-label="Part of a routine" className="size-3" />
                Part of a routine
                <button
                  type="button"
                  onClick={onDetachFromRoutine}
                  className="text-subtle underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  Detach
                </button>
              </span>
            ) : (
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/features/tasks/components/task-detail-fields.tsx src/features/tasks/components/task-detail-fields.test.tsx
  git commit -m "feat: add Detach control to the routine label in TaskDetailFields"
  ```

---

## Task 3: Wire Detach into the inline row (`task-item.tsx`), immediate commit

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx:19-31` (`TaskItemActions`), `:62-76` (`taskItemHandlers`), `:78-113` (`TaskItem` props), `:286-298` (`TaskDetailFields` usage)
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `detachFromRoutine(id, weekdays?)` on `TasksContextValue` (Task 1); `TaskDetailFields`'s `onDetachFromRoutine` prop (Task 2).
- Produces: `taskItemHandlers(id, actions)` includes `onDetachFromRoutine: (weekdays?: number[]) => void` in its returned object. `daily-view.tsx`, `weekly-view.tsx`, `day-agenda.tsx`, `day-timeline.tsx`, and `scope-tasks.tsx` all spread this helper's return value already, so none of them need changes to pick up the new handler — this covers both `TaskItem` and `TaskDetailDrawer` (Task 4 consumes the same prop from this task's `taskItemHandlers` change).

- [ ] **Step 1: Write the failing test**

  In `frontend/src/features/tasks/components/primitives.test.tsx`, add `onDetachFromRoutine: () => {},` to `noopHandlers` (after `onRepeatWeekdaysChange`, around line 17):

  ```ts
  const noopHandlers = {
    onToggle: () => {},
    onMemoChange: (_memo: string) => {},
    onTimeChange: (_time?: string) => {},
    onRepeatWeekdaysChange: (_weekdays: number[]) => {},
    onDetachFromRoutine: () => {},
    onPriorityChange: (_priority: boolean) => {},
    onDurationChange: (_durationMinutes?: number) => {},
    onBackgroundChange: (_background: boolean) => {},
    onDelete: () => {},
    onAddSubtask: (_title: string) => {},
    onToggleSubtask: (_id: string) => {},
    onRemoveSubtask: (_id: string) => {},
  };
  ```

  Then, inside `describe("TaskItem v2", ...)`, right after the `"toggles repeat weekdays from the expansion"` test (after its closing `});` around line 355), add:

  ```tsx
    it("detaches from routine via the expansion", () => {
      const onDetachFromRoutine = vi.fn();
      render(
        <TaskItem
          task={makeTask({ title: "dentist", repeatSourceId: "anchor-1" })}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
        />,
      );
      fireEvent.click(screen.getByText("dentist"));
      fireEvent.click(screen.getByText("Detach"));
      expect(onDetachFromRoutine).toHaveBeenCalledTimes(1);
    });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
  Expected: FAIL — `TaskItem` doesn't accept/forward `onDetachFromRoutine`, so `TaskDetailFields` never receives it and the button never renders.

- [ ] **Step 3: Add `detachFromRoutine` to `TaskItemActions`**

  In `frontend/src/features/tasks/components/task-item.tsx`, in the `TaskItemActions` interface (around line 23), change:

  ```ts
    setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  ```

  to:

  ```ts
    setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
    detachFromRoutine: (id: string, weekdays?: number[]) => void;
  ```

- [ ] **Step 4: Add it to `taskItemHandlers`**

  In the same file, in `taskItemHandlers` (around line 67), change:

  ```ts
      onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
  ```

  to:

  ```ts
      onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
      onDetachFromRoutine: (weekdays?: number[]) => actions.detachFromRoutine(id, weekdays),
  ```

- [ ] **Step 5: Thread it through `TaskItem`**

  In the same file, add `onDetachFromRoutine` to `TaskItem`'s props destructure (after `onRepeatWeekdaysChange,` around line 87) and type (after `onRepeatWeekdaysChange: (weekdays: number[]) => void;` around line 105):

  ```ts
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
    onDetachFromRoutine,
    onPriorityChange,
    ...
  }: {
    ...
    onRepeatWeekdaysChange: (weekdays: number[]) => void;
    onDetachFromRoutine: (weekdays?: number[]) => void;
    onPriorityChange: (priority: boolean) => void;
    ...
  }) {
  ```

  Then pass it to the inline `TaskDetailFields` (around line 291), after `onRepeatWeekdaysChange={onRepeatWeekdaysChange}`:

  ```tsx
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
            onDetachFromRoutine={onDetachFromRoutine}
            onPriorityChange={onPriorityChange}
            onDurationChange={onDurationChange}
            onBackgroundChange={onBackgroundChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
  ```

- [ ] **Step 6: Run the test to verify it passes**

  Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
  Expected: PASS

- [ ] **Step 7: Run the full test suite to confirm no other callers broke**

  Run: `npx vitest run`
  Expected: PASS — this confirms `day-agenda.test.tsx`, `day-timeline.test.tsx`, `task-calendar.test.tsx`, etc. still work now that `taskItemHandlers`'s return shape changed.

- [ ] **Step 8: Commit**

  ```bash
  git add src/features/tasks/components/task-item.tsx src/features/tasks/components/primitives.test.tsx
  git commit -m "feat: wire Detach into the inline task row, committing immediately"
  ```

---

## Task 4: Wire Detach into the drawer (`task-detail-drawer.tsx`), buffered until Done

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx:14-22` (`Draft`), `:24-34` (`draftFromTask`), `:36-66` (props), `:89-102` (`handleDone`), `:104` (`draftTask`), `:158-174` (`TaskDetailFields` usage)
- Test: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

**Interfaces:**
- Consumes: `TaskDetailFields`'s `onDetachFromRoutine` prop (Task 2); `onDetachFromRoutine: (weekdays?: number[]) => void` reaching `TaskDetailDrawer` via `taskItemHandlers` (Task 3) — no changes needed in `daily-view.tsx` / `weekly-view.tsx`.
- Produces: `TaskDetailDrawer` gains a required `onDetachFromRoutine: (weekdays?: number[]) => void` prop, called once from `handleDone` if the user clicked Detach during this session.

- [ ] **Step 1: Write the failing tests**

  In `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`, add `onDetachFromRoutine: () => {},` to `noopHandlers` (after `onRepeatWeekdaysChange`, around line 12):

  ```ts
  const noopHandlers = {
    onToggle: () => {},
    onClose: () => {},
    onMemoChange: (_memo: string) => {},
    onTimeChange: (_time?: string) => {},
    onRepeatWeekdaysChange: (_weekdays: number[]) => {},
    onDetachFromRoutine: (_weekdays?: number[]) => {},
    onPriorityChange: (_priority: boolean) => {},
    onDurationChange: (_durationMinutes?: number) => {},
    onBackgroundChange: (_background: boolean) => {},
    onDelete: () => {},
    onAddSubtask: (_title: string) => {},
    onToggleSubtask: (_id: string) => {},
    onRemoveSubtask: (_id: string) => {},
  };
  ```

  Then, right after the `describe("draft editing (buffered until Done)", ...)` block's closing (after line 256, before `describe("actions that stay immediate, not deferred to Done", ...)`), add a new block:

  ```tsx
    describe("detaching from a routine occurrence", () => {
      const routineTask = makeTask({
        id: "occ",
        title: "gym",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor-1",
      });

      it("swaps the routine label for the weekday picker immediately when Detach is clicked, before Done", () => {
        render(<TaskDetailDrawer task={routineTask} {...noopHandlers} />);
        expect(screen.getByLabelText("Part of a routine")).toBeTruthy();

        fireEvent.click(screen.getByText("Detach"));

        expect(screen.queryByLabelText("Part of a routine")).toBeNull();
        expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
      });

      it("Done calls onDetachFromRoutine with no weekdays when none were chosen after detaching", () => {
        const onDetachFromRoutine = vi.fn();
        const onRepeatWeekdaysChange = vi.fn();
        render(
          <TaskDetailDrawer
            task={routineTask}
            {...noopHandlers}
            onDetachFromRoutine={onDetachFromRoutine}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
          />,
        );

        fireEvent.click(screen.getByText("Detach"));
        fireEvent.click(screen.getByText("Done"));

        expect(onDetachFromRoutine).toHaveBeenCalledWith(undefined);
        expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
      });

      it("Done calls onDetachFromRoutine with the chosen weekdays when the picker was also used", () => {
        const onDetachFromRoutine = vi.fn();
        const onRepeatWeekdaysChange = vi.fn();
        render(
          <TaskDetailDrawer
            task={routineTask}
            {...noopHandlers}
            onDetachFromRoutine={onDetachFromRoutine}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
          />,
        );

        fireEvent.click(screen.getByText("Detach"));
        fireEvent.click(screen.getByLabelText("Repeat on Monday"));
        fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
        fireEvent.click(screen.getByText("Done"));

        expect(onDetachFromRoutine).toHaveBeenCalledWith([1, 3]);
        expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
      });

      it("Cancel after Detach discards the change and calls neither commit handler", () => {
        const onDetachFromRoutine = vi.fn();
        const onRepeatWeekdaysChange = vi.fn();
        render(
          <TaskDetailDrawer
            task={routineTask}
            {...noopHandlers}
            onDetachFromRoutine={onDetachFromRoutine}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
          />,
        );

        fireEvent.click(screen.getByText("Detach"));
        fireEvent.click(screen.getByText("Cancel"));

        expect(onDetachFromRoutine).not.toHaveBeenCalled();
        expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
      });

      it("Done does not call onDetachFromRoutine when Detach was never clicked", () => {
        const onDetachFromRoutine = vi.fn();
        render(
          <TaskDetailDrawer
            task={routineTask}
            {...noopHandlers}
            onDetachFromRoutine={onDetachFromRoutine}
          />,
        );
        fireEvent.click(screen.getByText("Done"));
        expect(onDetachFromRoutine).not.toHaveBeenCalled();
      });
    });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
  Expected: FAIL — `TaskDetailDrawer` doesn't accept `onDetachFromRoutine`, there's no "Detach" button rendered yet, and clicking it does nothing.

- [ ] **Step 3: Add `detached` to `Draft` and `draftFromTask`**

  In `frontend/src/features/tasks/components/task-detail-drawer.tsx`, change the `Draft` interface (lines 14-22):

  ```ts
  interface Draft {
    done: boolean;
    memo: string;
    time?: string;
    durationMinutes?: number;
    priority: boolean;
    background: boolean;
    repeatWeekdays: number[];
    detached: boolean;
  }
  ```

  and `draftFromTask` (lines 24-34):

  ```ts
  function draftFromTask(task: Task): Draft {
    return {
      done: task.done,
      memo: task.memo ?? "",
      time: task.time,
      durationMinutes: task.durationMinutes,
      priority: !!task.priority,
      background: !!task.background,
      repeatWeekdays: task.repeatWeekdays ?? [],
      detached: false,
    };
  }
  ```

- [ ] **Step 4: Add the `onDetachFromRoutine` prop**

  In the same file, add it to `TaskDetailDrawer`'s props destructure and type (around lines 42 and 57):

  ```ts
  export function TaskDetailDrawer({
    task,
    onToggle,
    onClose,
    onMemoChange,
    onTimeChange,
    onRepeatWeekdaysChange,
    onDetachFromRoutine,
    onPriorityChange,
    ...
  }: {
    task: Task;
    onToggle: () => void;
    onClose: () => void;
    onMemoChange: (memo: string) => void;
    onTimeChange: (time?: string) => void;
    onRepeatWeekdaysChange: (weekdays: number[]) => void;
    onDetachFromRoutine: (weekdays?: number[]) => void;
    onPriorityChange: (priority: boolean) => void;
    ...
  }) {
  ```

- [ ] **Step 5: Update `handleDone` and `draftTask`**

  In the same file, replace the tail of `handleDone` (lines 96-101):

  ```ts
      const original = task.repeatWeekdays ?? [];
      const changed =
        draft.repeatWeekdays.length !== original.length ||
        draft.repeatWeekdays.some((d, i) => d !== original[i]);
      if (changed) onRepeatWeekdaysChange(draft.repeatWeekdays);
      onClose();
    };
  ```

  with:

  ```ts
      const original = task.repeatWeekdays ?? [];
      const weekdaysChanged =
        draft.repeatWeekdays.length !== original.length ||
        draft.repeatWeekdays.some((d, i) => d !== original[i]);
      if (draft.detached) {
        onDetachFromRoutine(weekdaysChanged ? draft.repeatWeekdays : undefined);
      } else if (weekdaysChanged) {
        onRepeatWeekdaysChange(draft.repeatWeekdays);
      }
      onClose();
    };
  ```

  Then replace `draftTask` (line 104):

  ```ts
    const draftTask: Task = { ...task, ...draft };
  ```

  with:

  ```ts
    const draftTask: Task = {
      ...task,
      ...draft,
      repeatSourceId: draft.detached ? undefined : task.repeatSourceId,
    };
  ```

- [ ] **Step 6: Wire the button through to `TaskDetailFields`**

  In the same file, in the `TaskDetailFields` usage (around line 162), after `onRepeatWeekdaysChange={(repeatWeekdays) => setDraft((d) => ({ ...d, repeatWeekdays }))}`, add:

  ```tsx
            onDetachFromRoutine={() => setDraft((d) => ({ ...d, detached: true }))}
  ```

- [ ] **Step 7: Run the tests to verify they pass**

  Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
  Expected: PASS

- [ ] **Step 8: Run the full suite**

  Run: `npx vitest run`
  Expected: PASS

- [ ] **Step 9: Commit**

  ```bash
  git add src/features/tasks/components/task-detail-drawer.tsx src/features/tasks/components/task-detail-drawer.test.tsx
  git commit -m "feat: buffer Detach in the drawer until Done, combined with any new weekdays"
  ```

---

## Task 5: Manual verification in the running app

**Files:** none (no code changes)

- [ ] **Step 1: Start the dev server**

  Run: `npm run dev` (from `frontend/`), then open the app in a browser.

- [ ] **Step 2: Set up a routine**

  Create a task, open its detail drawer, select a couple of weekdays in the repeat picker, click Done. Navigate to (or wait for) one of those matching days so the routine occurrence is spawned.

- [ ] **Step 3: Detach from the inline row**

  On the calendar, click the spawned occurrence to expand it inline. Confirm it shows "Part of a routine" with a "Detach" button. Click Detach — confirm it immediately becomes a plain task with an empty, editable weekday picker, and the anchor's other occurrences are unaffected.

- [ ] **Step 4: Detach from the drawer, with Cancel**

  Repeat routine setup for a second occurrence. Open it in the detail drawer (not the inline row). Click Detach — confirm the label swaps to the weekday picker immediately. Click Cancel. Reopen the drawer — confirm it still shows "Part of a routine" (the detach was discarded).

- [ ] **Step 5: Detach from the drawer, with new weekdays, then Done**

  Open the same occurrence again, click Detach, pick two weekdays in the now-visible picker, click Done. Confirm the task now repeats independently on those two weekdays and no longer references the original routine.

- [ ] **Step 6: Report results**

  Note any visual or behavioral issues found. If everything matches Steps 3-5, the feature is complete.
