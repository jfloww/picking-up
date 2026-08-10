# Editable Task Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main task's title editable inside the Task Details drawer, following the drawer's existing buffered-until-Done convention.

**Architecture:** A new `setTitle` store action (mirroring `setMemo`'s shape) lands the write. `TaskDetailDrawer`'s plain `<h2>{task.title}</h2>` becomes an always-visible, auto-growing `<textarea>` bound to `draft.title`, committed only when `handleDone` runs — exactly like memo, time, priority, background, due date, and repeat already work in this same drawer. `task-item.tsx`'s `taskItemHandlers` wires the new action to a new `onTitleChange` prop, which all 4 calendar view files pick up automatically via their existing `{...taskItemHandlers(...)}` spread.

**Tech Stack:** Next.js 15 App Router + React 19 + TypeScript (frontend), Vitest + Testing Library (frontend tests). No backend changes — the generic task `PUT` already accepts `title`.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-10-editable-task-title-design.md`. Every rule below traces to a section there.
- Frontend-only change. No backend/API changes.
- `setTitle`'s blank-guard silently no-ops on an empty trimmed value (matches `editSubtaskTitle`'s guard) — no validation-error UI.
- The title field follows the drawer's buffered-until-Done convention (like memo/time/priority), **not** the Subtask Detail panel's immediate-commit-on-blur/Enter convention.
- Enter inside the title field must not insert a newline and must not submit/close the drawer.
- Frontend tests run via `npx vitest run <path>` from `frontend/`.

---

## File Structure

**Frontend (`frontend/src/features/tasks/`):**
- `store.tsx` — add `setTitle(id: string, title: string): void` to `TasksContextValue` and its implementation, next to `setMemo`.
- `store.test.tsx` — add tests for `setTitle` next to the existing `setMemo` test.
- `components/task-detail-drawer.tsx` — add `title: string` to `Draft`, seed it in `draftFromTask`, replace the `<h2>` with an auto-growing `<textarea>`, add the commit line to `handleDone`, add the new `onTitleChange` prop.
- `components/task-detail-drawer.test.tsx` — add title-editing tests; adapt two existing assertions that currently target `<h2>` text content via `getByText`.
- `components/task-item.tsx` — add `setTitle` to `TaskItemActions` and `onTitleChange: (title: string) => actions.setTitle(id, title)` to `taskItemHandlers`.

No other file changes needed — `daily-view.tsx`, `weekly-view.tsx`, `monthly-view.tsx`, and `bucket-list-view.tsx` all render `<TaskDetailDrawer {...taskItemHandlers(selectedTask.id, actions)} .../>` and pick up `onTitleChange` automatically.

---

## Task 1: Store — `setTitle` action

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx:303-309` (interface), `frontend/src/features/tasks/store.tsx:630-635` (implementation, immediately after `setMemo`)
- Test: `frontend/src/features/tasks/store.test.tsx:99-110` (add tests immediately after the existing `setMemo and removeTask update state and repository` test)

**Interfaces:**
- Produces: `setTitle(id: string, title: string): void` on `TasksContextValue`, matching `setMemo(id: string, memo: string): void`'s exact shape. Task 2's drawer and Task 2's `task-item.tsx` wiring consume this.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/store.test.tsx`, immediately after the existing test that ends at line 110 (`it("setMemo and removeTask update state and repository", ...)`), add:

```typescript
  it("setTitle trims and commits a changed title", async () => {
    const task = makeTask({ id: "a", title: "old title", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setTitle("a", "  new title  "));
    expect(result.current.tasks[0].title).toBe("new title");
    await waitFor(() => expect(repo.tasks[0].title).toBe("new title"));
  });

  it("setTitle is a no-op when the trimmed title is blank", async () => {
    const task = makeTask({ id: "a", title: "old title", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setTitle("a", "   "));
    expect(result.current.tasks[0].title).toBe("old title");
    expect(repo.tasks[0].title).toBe("old title");
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx` from `frontend/`.
Expected: both new tests FAIL with `result.current.setTitle is not a function` (the action doesn't exist yet).

- [ ] **Step 3: Add `setTitle` to the `TasksContextValue` interface**

In `frontend/src/features/tasks/store.tsx`, in the `TasksContextValue` interface (currently lines 303-309), immediately after the `setMemo` line:

```typescript
  setMemo: (id: string, memo: string) => void;
  setTitle: (id: string, title: string) => void;
```

- [ ] **Step 4: Implement `setTitle`**

In `frontend/src/features/tasks/store.tsx`, immediately after the existing `setMemo` action (currently lines 630-635):

```typescript
      setMemo(id, memo) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        persistUpdate(task);
      },
      setTitle(id, title) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = { ...current, title: trimmed };
        persistUpdate(task);
      },
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx` from `frontend/`.
Expected: PASS, all tests in the file green (no regressions in the surrounding suite).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add setTitle store action for editing a task's title"
```

---

## Task 2: Drawer — editable title field + wiring

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

**Interfaces:**
- Consumes: `setTitle(id: string, title: string): void` from Task 1's store (via the `actions` object already passed into `taskItemHandlers`).
- Produces: `TaskDetailDrawer`'s new required prop `onTitleChange: (title: string) => void`; `taskItemHandlers`'s new `onTitleChange` entry, picked up automatically by `daily-view.tsx`, `weekly-view.tsx`, `monthly-view.tsx`, and `bucket-list-view.tsx` through their existing `{...taskItemHandlers(...)}` spread onto `<TaskDetailDrawer>` — no changes needed in those 4 files.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`, add `onTitleChange: (_title: string) => {}` to the `noopHandlers` object (currently lines 7-28), immediately after `onMemoChange`:

```typescript
  onMemoChange: (_memo: string) => {},
  onTitleChange: (_title: string) => {},
```

Then adapt the two existing assertions that currently target the `<h2>`'s text content, since the title is about to become a `<textarea>`'s value instead of a text node:

Replace (line 45):
```typescript
    expect(screen.getByText("write tests")).toBeTruthy();
```
with:
```typescript
    expect(screen.getByDisplayValue("write tests")).toBeTruthy();
```

Replace (line 193):
```typescript
      expect(screen.getByText("write tests").className).toContain("line-through");
```
with:
```typescript
      expect(screen.getByDisplayValue("write tests").className).toContain("line-through");
```

Then, inside the `describe("draft editing (buffered until Done)", ...)` block (currently starting at line 146), add these new tests (placed after the existing `"Cancel discards every edit and closes without calling any commit handler"` test):

```typescript
    it("does not call onTitleChange immediately when the title is edited", () => {
      const handlers = { onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.change(screen.getByDisplayValue("write tests"), { target: { value: "updated title" } });

      expect(handlers.onTitleChange).not.toHaveBeenCalled();
    });

    it("Done commits the edited title, trimmed", () => {
      const handlers = { onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.change(screen.getByDisplayValue("write tests"), { target: { value: "  updated title  " } });
      fireEvent.click(screen.getByText("Done"));

      expect(handlers.onTitleChange).toHaveBeenCalledWith("  updated title  ");
    });

    it("Done does not call onTitleChange when the title was never touched", () => {
      const handlers = { onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.click(screen.getByText("Done"));

      expect(handlers.onTitleChange).not.toHaveBeenCalled();
    });

    it("Cancel discards an edited title without calling onTitleChange", () => {
      const handlers = { onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.change(screen.getByDisplayValue("write tests"), { target: { value: "discarded" } });
      fireEvent.click(screen.getByText("Cancel"));

      expect(handlers.onTitleChange).not.toHaveBeenCalled();
    });

    it("Enter inside the title field does not insert a newline or close the drawer", () => {
      const handlers = { onClose: vi.fn(), onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      const titleField = screen.getByDisplayValue("write tests") as HTMLTextAreaElement;
      fireEvent.change(titleField, { target: { value: "write tests\n" } });
      fireEvent.keyDown(titleField, { key: "Enter" });

      expect(handlers.onClose).not.toHaveBeenCalled();
      expect(handlers.onTitleChange).not.toHaveBeenCalled();
    });

    it("pressing Escape discards an edited title without calling onTitleChange", () => {
      const handlers = { onTitleChange: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.change(screen.getByDisplayValue("write tests"), { target: { value: "discarded" } });
      fireEvent.keyDown(document, { key: "Escape" });

      expect(handlers.onTitleChange).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx` from `frontend/`.
Expected: the 5 new tests FAIL (no title textarea exists yet, `onTitleChange` prop doesn't exist on the component's type), and the two adapted `getByDisplayValue("write tests")` assertions also FAIL against the current `<h2>` markup.

- [ ] **Step 3: Add `title` to the `Draft` interface and seed it in `draftFromTask`**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`, in the `Draft` interface (currently lines 17-29), add `title: string;` as the first field:

```typescript
interface Draft {
  title: string;
  done: boolean;
  memo: string;
```

In `draftFromTask` (currently lines 39-59), add `title: task.title,` as the first field of the returned object:

```typescript
  return {
    title: task.title,
    done: task.done,
    memo: task.memo ?? "",
```

- [ ] **Step 4: Add the `onTitleChange` prop**

In the `TaskDetailDrawer` function's destructured props (currently lines 61-86) and its type annotation (currently lines 86-114), add `onTitleChange` immediately after `onMemoChange` in both places:

```typescript
export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTitleChange,
  onTimeChange,
```

```typescript
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTitleChange: (title: string) => void;
  onTimeChange: (time?: string) => void;
```

- [ ] **Step 5: Add the commit line to `handleDone`**

In `handleDone` (currently lines 181-218), immediately after the existing memo line:

```typescript
    if (draft.memo !== (task.memo ?? "")) onMemoChange(draft.memo);
    if (draft.title !== task.title) onTitleChange(draft.title);
```

- [ ] **Step 6: Add a `titleRef` and auto-grow effect**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`, add a module-level `autoGrow` helper (mirroring `subtask-detail-panel.tsx`'s own local copy of the same helper) directly above the `draftFromTask` function:

```typescript
// A single-line title clips long text instead of showing all of it — same
// auto-grow technique already used for the subtask title/notes fields and
// this drawer's own memo textarea.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
```

Inside the `TaskDetailDrawer` component, add a `titleRef` next to the existing `asideRef` (currently line 138):

```typescript
  const asideRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
```

Add an effect that re-runs `autoGrow` whenever `draft.title` changes, placed after the existing `useEffect(() => { setVisible(true); }, [])` block (currently lines 140-142):

```typescript
  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title]);
```

- [ ] **Step 7: Replace the `<h2>` with the editable textarea**

Replace the current title block (lines 279-292):

```typescript
          <div className="min-w-0 flex-1 space-y-1">
            <h2
              className={cn(
                "text-xl leading-tight font-bold tracking-tight sm:text-[22px]",
                draft.done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </h2>
            {task.done && task.completedAt && (
              <p className="text-xs text-subtle">Completed {completedAtLabel(task.completedAt)}</p>
            )}
          </div>
```

with:

```typescript
          <div className="min-w-0 flex-1 space-y-1">
            <textarea
              ref={titleRef}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              onKeyDown={(e) => {
                // A title stays one logical line even once it visually
                // wraps — Enter must not insert a newline. Unlike the
                // Subtask Detail panel's title field, it also must not
                // submit/close the drawer: no other buffered field here
                // auto-submits on Enter, and title isn't the exception.
                if (e.key === "Enter") e.preventDefault();
              }}
              rows={1}
              aria-label="Task title"
              className={cn(
                "w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent text-xl leading-tight font-bold tracking-tight outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-[22px]",
                draft.done && "text-muted-foreground line-through",
              )}
            />
            {task.done && task.completedAt && (
              <p className="text-xs text-subtle">Completed {completedAtLabel(task.completedAt)}</p>
            )}
          </div>
```

- [ ] **Step 8: Run the drawer tests to confirm they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx` from `frontend/`.
Expected: PASS, all tests in the file green (no regressions in the surrounding suite — the file has many other `describe` blocks that render `<TaskDetailDrawer>` with `{...noopHandlers}`, which now includes `onTitleChange`).

- [ ] **Step 9: Wire `setTitle` through `task-item.tsx`**

In `frontend/src/features/tasks/components/task-item.tsx`, add `setTitle` to the `TaskItemActions` interface (currently lines 20-42), immediately after `setMemo`:

```typescript
interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTitle: (id: string, title: string) => void;
  setTime: (id: string, time: string | undefined) => void;
```

Add the corresponding line to `taskItemHandlers` (currently lines 73-101), immediately after `onMemoChange`:

```typescript
export function taskItemHandlers(id: string, actions: TaskItemActions) {
  return {
    onToggle: () => actions.toggleTask(id),
    onMemoChange: (memo: string) => actions.setMemo(id, memo),
    onTitleChange: (title: string) => actions.setTitle(id, title),
    onTimeChange: (time?: string) => actions.setTime(id, time),
```

- [ ] **Step 10: Run the full frontend test suite and type-check**

Run from `frontend/`:
```bash
npx vitest run
npx tsc --noEmit
```
Expected: all tests pass, no type errors. `tsc` matters here specifically because `daily-view.tsx`, `weekly-view.tsx`, `monthly-view.tsx`, and `bucket-list-view.tsx` all pass the real store's `actions` object into `taskItemHandlers`, and the real store (from Task 1) now has `setTitle` — confirm nothing else in those 4 files broke from `TaskDetailDrawer`'s prop type gaining a new required field.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx frontend/src/features/tasks/components/task-item.tsx
git commit -m "feat: make the task title editable in the Task Details drawer"
```
