# Daily Agenda Drag-to-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a dedicated handle on an "All Day To-Do" card in Daily's agenda panel to reorder it within that list, persisting the new order immediately.

**Architecture:** A new `order: number` field on `Task` (backend + frontend), a pure `computeOrderBetween` helper for fractional-order math, an independent pointer-gesture hook (`useDragToReorder`, sibling to the existing `useDragToSchedule`/`useDragToRescheduleDay`), and a small always-visible `GripVertical` handle wired into `day-agenda.tsx` that only appears on "All Day To-Do" cards.

**Tech Stack:** Django/DRF (existing), Next.js/React 19 (existing), no new dependencies — `GripVertical` is already available via the `lucide-react` package already used elsewhere in this codebase (`Plus`, `RotateCw`, `Star`, etc.).

## Global Constraints

- **Scope:** "All Day To-Do" only. "Next Up" (time-sorted) and "Done Today" are untouched — no handle, no reordering.
- **Independent hook, no changes to `useDragToSchedule` or `useDragToRescheduleDay`.**
- **Handle is always visible, not hover-only** (hover doesn't exist on touch).
- **The handle's `onPointerDown` stops propagation** — each All-Day-To-Do card is already wrapped in `useDragToSchedule`'s handlers (the existing drag-to-timeline feature); without stopping propagation, a handle-drag would also start that unrelated gesture.
- **Fractional ordering:** a drag changes exactly one task's `order` (the midpoint between its new neighbors, or an offset from the single neighbor at a list edge) — never a bulk renumbering of the list. Same persistence shape as every other single-field store action (`setPriority`, `setDuration`): one `repo.update(...).catch(handleSyncFailure)` call.
- **Every task has a real `order` value from day one** — a migration backfills existing rows from their `created_at` order; nothing in this plan ever needs to treat `order` as optional/unset.
- Dropping in the same position, or releasing outside the list, is a no-op: no dispatch, no save.

---

### Task 1: Backend — `order` field, migration, serializer

**Files:**
- Modify: `backend/apps/tasks/models.py`
- Create: `backend/apps/tasks/migrations/0006_task_order.py`
- Modify: `backend/apps/tasks/serializers.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `Task.order` (Django `FloatField`, default `0`), exposed on the API as `order` (float, default `0.0`, present on every list/create/update response). Task 2's `mapping.ts` reads/writes this exact field name.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/tasks/tests.py`, inside the existing `TaskApiTests` class:

```python
    def test_order_defaults_to_zero_and_is_updatable(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(id=str(uuid.uuid4())), format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["order"], 0)

        task_id = response.data["id"]
        response = client.put(
            f"/api/tasks/{task_id}/",
            make_task_payload(id=task_id, order=2.5),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["order"], 2.5)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskApiTests.test_order_defaults_to_zero_and_is_updatable -v 2`
Expected: FAIL — `KeyError: 'order'` (the field doesn't exist yet).

(This project's backend test runs always blank the Oracle env vars for the duration of the test command — this machine's Oracle user lacks permission to create Django's throwaway test database, a pre-existing, already-tracked gap unrelated to this feature. The override falls back to an in-memory SQLite test database.)

- [ ] **Step 3: Add the field**

In `backend/apps/tasks/models.py`, in the `Task` model, add `order` directly above `updated_at`:

```python
    background = models.BooleanField(blank=True, null=True)
    order = models.FloatField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
```

- [ ] **Step 4: Write the migration**

Create `backend/apps/tasks/migrations/0006_task_order.py`:

```python
from django.db import migrations, models


def backfill_order(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    for index, task in enumerate(Task.objects.order_by("created_at", "id")):
        Task.objects.filter(pk=task.pk).update(order=index)


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0005_backfill_bucket_categories"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="order",
            field=models.FloatField(default=0),
        ),
        migrations.RunPython(backfill_order, migrations.RunPython.noop),
    ]
```

- [ ] **Step 5: Add the serializer field**

In `backend/apps/tasks/serializers.py`, add this field declaration to `TaskSerializer`, directly after `background`:

```python
    background = serializers.BooleanField(required=False, allow_null=True, default=None)
    order = serializers.FloatField(required=False, default=0.0)
```

Add `"order"` to `Meta.fields`, directly after `"background"`:

```python
        fields = (
            "id",
            "title",
            "memo",
            "done",
            "scope_kind",
            "scope_value",
            "bucket_category",
            "rolled_from_kind",
            "rolled_from_value",
            "created_at",
            "completed_at",
            "time",
            "due_date",
            "subtasks",
            "repeat_weekdays",
            "repeat_source",
            "excluded_dates",
            "priority",
            "duration_minutes",
            "background",
            "order",
        )
```

- [ ] **Step 6: Run migrations, then run the test to verify it passes**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py migrate`
Expected: applies `tasks.0006_task_order` cleanly.

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2`
Expected: PASS — every test in `apps/tasks/tests.py`, including the new one.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/models.py backend/apps/tasks/migrations/0006_task_order.py backend/apps/tasks/serializers.py backend/apps/tasks/tests.py
git commit -m "feat: add a persisted order field to Task"
```

---

### Task 2: Frontend — data model plumbing and the `setOrder` store action

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/api/mapping.ts`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Create: `frontend/src/features/tasks/lib/reorder.ts`
- Create: `frontend/src/features/tasks/lib/reorder.test.ts`
- Modify: `frontend/src/features/tasks/lib/routines.ts`
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: backend's `order` field (Task 1).
- Produces: `Task.order: number` (required, `types.ts`). `computeOrderBetween(before?: number, after?: number): number` (`lib/reorder.ts`) — Task 4 imports this directly. `TasksContextValue.setOrder(id: string, order: number): void` (`store.tsx`) — Task 4 calls this from `day-agenda.tsx`.

- [ ] **Step 1: Write the failing test for `computeOrderBetween`**

Create `frontend/src/features/tasks/lib/reorder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { computeOrderBetween } from "./reorder";

describe("computeOrderBetween", () => {
  it("returns 0 when there are no neighbors (first task in an empty list)", () => {
    expect(computeOrderBetween(undefined, undefined)).toBe(0);
  });

  it("returns a value less than the only neighbor when dropped at the top edge", () => {
    expect(computeOrderBetween(undefined, 5)).toBeLessThan(5);
  });

  it("returns a value greater than the only neighbor when dropped at the bottom edge", () => {
    expect(computeOrderBetween(5, undefined)).toBeGreaterThan(5);
  });

  it("returns the midpoint when dropped between two neighbors", () => {
    expect(computeOrderBetween(2, 6)).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/lib/reorder.test.ts`
Expected: FAIL — cannot find module `./reorder` (doesn't exist yet).

- [ ] **Step 3: Write `computeOrderBetween`**

Create `frontend/src/features/tasks/lib/reorder.ts`:

```typescript
// Fractional ordering: a drag only ever changes the single dragged task's
// order to a value between its new neighbors, so exactly one task updates
// per reorder instead of renumbering the whole list. `before`/`after` are
// the order values of the tasks immediately above/below the drop position
// (undefined at either edge of the list).
const EDGE_GAP = 1;

export function computeOrderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - EDGE_GAP;
  if (after === undefined) return before + EDGE_GAP;
  return (before + after) / 2;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/lib/reorder.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 5: Add `order` to the `Task` type**

In `frontend/src/features/tasks/types.ts`, add `order: number;` to the `Task` interface, directly after `dueDate`:

```typescript
  dueDate?: string; // "YYYY-MM-DD"; independent of scope; unset for routine tasks
  order: number; // fractional manual position within "All Day To-Do"; meaningless for every other list, but always present
}
```

- [ ] **Step 6: Wire `order` through the API mapping**

In `frontend/src/features/tasks/api/mapping.ts`, add `order: number;` to the `ApiTask` interface, directly after `background`:

```typescript
  background: boolean | null;
  order: number;
}
```

In `toApiPayload`, add directly after `background: task.background ?? null,`:

```typescript
    background: task.background ?? null,
    order: task.order,
```

In `fromApiPayload`, add directly after `background: payload.background ?? undefined,`:

```typescript
    background: payload.background ?? undefined,
    order: payload.order,
```

- [ ] **Step 7: Give every constructed `Task` a real `order`**

`order` is now required on `Task`, so every place that builds a full `Task` object (not just spreads an existing one) needs a value. There are three:

In `frontend/src/features/tasks/test-utils.tsx`, add `order: 0,` to `makeTask`'s defaults, directly after `createdAt`:

```typescript
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    order: 0,
    ...overrides,
  };
}
```

In `frontend/src/features/tasks/lib/routines.ts`, add `order: 0,` to the spawned-task object literal inside `materializeRoutines`'s `.map(...)`, directly after `scope`. A freshly-materialized routine occurrence landing at the front of "All Day To-Do" (order `0`, likely sorting first or near-first) is a deliberate, simple default — not worth threading the current task list through this function just to compute a precise append position for what's already a secondary concern of this function:

```typescript
    .map((anchor) => ({
      id: crypto.randomUUID(),
      title: anchor.title,
      memo: anchor.memo,
      time: anchor.time,
      done: false,
      scope: { kind: "day", date: today },
      order: 0,
      repeatSourceId: anchor.id,
      createdAt: new Date().toISOString(),
    }));
```

In `frontend/src/features/tasks/store.tsx`, `addBucketItem` gets a task literal with `order: 0` too (bucket tasks never render in an order-sensitive list, so this value is never read) — see Step 8 below, which shows the exact surrounding code.

- [ ] **Step 8: Write the failing store tests**

Append to `frontend/src/features/tasks/store.test.tsx`:

```typescript
  it("setOrder updates a task's order and persists it", async () => {
    const task = makeTask({ id: "a", order: 1, scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setOrder("a", 2.5));

    expect(result.current.tasks[0].order).toBe(2.5);
    await waitFor(() => expect(repo.tasks[0].order).toBe(2.5));
  });

  it("addTask appends a new day-scoped untimed task after the current highest All-Day-To-Do order for that day", async () => {
    const today = todayKey();
    const existing = makeTask({ id: "a", order: 3, scope: { kind: "day", date: today } });
    const { result } = setup(fakeRepository([existing]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let created: ReturnType<typeof result.current.addTask>;
    act(() => {
      created = result.current.addTask("new task", { kind: "day", date: today });
    });

    expect(created?.order).toBe(4);
  });

  it("addTask on a task with no existing All-Day-To-Do siblings for that day starts at order 1", async () => {
    const { result } = setup(fakeRepository([]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let created: ReturnType<typeof result.current.addTask>;
    act(() => {
      created = result.current.addTask("first task", { kind: "day", date: todayKey() });
    });

    expect(created?.order).toBe(1);
  });
```

- [ ] **Step 9: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — `setOrder is not a function`, and the `addTask` tests fail because `created?.order` is `undefined`.

- [ ] **Step 10: Add `setOrder` and update `addTask`/`addBucketItem`**

In `frontend/src/features/tasks/store.tsx`, add `setOrder: (id: string, order: number) => void;` to the `TasksContextValue` interface, directly after `setDueDate`:

```typescript
  setDueDate: (id: string, dueDate: string | undefined) => void;
  setOrder: (id: string, order: number) => void;
```

Replace the existing `addTask` method with:

```typescript
      addTask(title, scope) {
        const trimmed = title.trim();
        if (!trimmed) return undefined;
        const order =
          scope.kind === "day"
            ? Math.max(
                0,
                ...state.tasks
                  .filter(
                    (t) =>
                      t.scope.kind === "day" &&
                      t.scope.date === scope.date &&
                      !t.time &&
                      !t.done,
                  )
                  .map((t) => t.order),
              ) + 1
            : 0;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          order,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
```

Replace the existing `addBucketItem` method with:

```typescript
      addBucketItem(title, categoryId) {
        const trimmed = title.trim();
        if (!trimmed || !categoryId) return undefined;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope: { kind: "bucket", categoryId },
          order: 0,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
```

Add a `setOrder` method to the returned actions object, directly after `setDueDate`'s implementation:

```typescript
      setOrder(id, order) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, order };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS — all tests in the file, including the three new ones.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors — confirms every `Task` construction site across the codebase now supplies `order`.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/api/mapping.ts frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/lib/reorder.ts frontend/src/features/tasks/lib/reorder.test.ts frontend/src/features/tasks/lib/routines.ts frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add order field, computeOrderBetween, and the setOrder store action"
```

---

### Task 3: Frontend — `useDragToReorder` hook

**Files:**
- Create: `frontend/src/features/tasks/components/use-drag-to-reorder.ts`
- Test: `frontend/src/features/tasks/components/use-drag-to-reorder.test.tsx`

**Interfaces:**
- Produces: `useDragToReorder(options: { itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>; orderedIds: string[]; onReorder: (id: string, insertBeforeId: string | null) => void }): { dragState: ReorderDragState | null; getDragHandlers: (id: string, title: string) => {...} }`. `ReorderDragState` has `{ id, title, pointerX, pointerY, insertBeforeId: string | null }` — `insertBeforeId` is the id of the card the drop would land above, or `null` meaning "at the end." Task 4 wires this directly into `day-agenda.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/use-drag-to-reorder.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToReorder } from "./use-drag-to-reorder";

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

function Harness({
  onReorder,
}: {
  onReorder: (id: string, insertBeforeId: string | null) => void;
}) {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToReorder({
    itemRefs,
    orderedIds: ["a", "b", "c"],
    onReorder,
  });

  return (
    <div>
      <div
        ref={(el) => {
          itemRefs.current["a"] = el;
        }}
        data-testid="item-a"
      >
        <button type="button" data-testid="handle-a" {...getDragHandlers("a", "Task A")} onClick={() => onReorder("clicked", null)}>
          Handle A
        </button>
      </div>
      <div
        ref={(el) => {
          itemRefs.current["b"] = el;
        }}
        data-testid="item-b"
      />
      <div
        ref={(el) => {
          itemRefs.current["c"] = el;
        }}
        data-testid="item-c"
      />
      <div data-testid="target">{dragState ? (dragState.insertBeforeId ?? "end") : "not-dragging"}</div>
    </div>
  );
}

function setup(onReorder = vi.fn()) {
  render(<Harness onReorder={onReorder} />);
  mockRect(screen.getByTestId("item-a"), { top: 0, bottom: 50, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-b"), { top: 50, bottom: 100, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-c"), { top: 100, bottom: 150, left: 0, right: 100 });
  return { onReorder, handle: screen.getByTestId("handle-a") };
}

describe("useDragToReorder", () => {
  it("does not reorder on a plain click (no movement past the threshold)", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(handle);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith("clicked", null);
  });

  it("resolves to the item whose upper half the pointer is over, and shows it while dragging", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 }); // upper half of item-b (50-100)
    expect(screen.getByTestId("target").textContent).toBe("b");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).toHaveBeenCalledWith("a", "b");
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("resolves to the end (null) when the pointer is past every item's midpoint", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 140 }); // lower half of item-c
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 140 });
    expect(onReorder).toHaveBeenCalledWith("a", null);
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.click(handle);
    expect(onReorder).toHaveBeenCalledTimes(1); // only the reorder call
    expect(onReorder).toHaveBeenCalledWith("a", "b");
  });

  it("cancels cleanly on pointercancel without reordering", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("does not capture the pointer on a plain click (would break nested click handlers)", () => {
    const { handle } = setup();
    const captureSpy = vi.fn();
    handle.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the pointer once a real drag starts (movement past the threshold)", () => {
    const { handle } = setup();
    const captureSpy = vi.fn();
    handle.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(captureSpy).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reorder.test.tsx`
Expected: FAIL — cannot find module `./use-drag-to-reorder` (doesn't exist yet).

- [ ] **Step 3: Write the hook**

Create `frontend/src/features/tasks/components/use-drag-to-reorder.ts`:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export interface ReorderDragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  // Id of the card the drop would land above; null means "at the end."
  insertBeforeId: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToReorder(options: {
  itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  orderedIds: string[];
  onReorder: (id: string, insertBeforeId: string | null) => void;
}) {
  const { itemRefs, orderedIds, onReorder } = options;
  const [dragState, setDragState] = useState<ReorderDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientY: number): string | null => {
      const refs = itemRefs.current;
      for (const id of orderedIds) {
        const el = refs[id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return id;
      }
      return null;
    },
    [itemRefs, orderedIds],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // This hook is designed specifically for a small handle nested
        // inside a card that already carries a *different*, unrelated
        // drag gesture (drag-to-schedule) on its own pointerdown — without
        // stopping propagation here, pressing the handle would also start
        // that other gesture.
        e.stopPropagation();
        gestureRef.current = {
          id,
          title,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;

        if (!gesture.moved) {
          const dx = e.clientX - gesture.startX;
          const dy = e.clientY - gesture.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          gesture.moved = true;
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          insertBeforeId: resolve(e.clientY),
        });
      },
      onPointerUp: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;

        const target = e.currentTarget as HTMLElement;
        if (typeof target.releasePointerCapture === "function") {
          target.releasePointerCapture(e.pointerId);
        }

        if (gesture.moved) {
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          onReorder(gesture.id, resolve(e.clientY));
        }
        setDragState(null);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;
        setDragState(null);
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    }),
    [resolve, onReorder],
  );

  return { dragState, getDragHandlers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/use-drag-to-reorder.test.tsx`
Expected: PASS — all nine tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/use-drag-to-reorder.ts frontend/src/features/tasks/components/use-drag-to-reorder.test.tsx
git commit -m "feat: add useDragToReorder, an independent pointer-gesture hook for list reordering"
```

---

### Task 4: Frontend — wire the handle into `day-agenda.tsx`

**Files:**
- Modify: `frontend/src/features/tasks/components/day-agenda.tsx`
- Modify: `frontend/src/features/tasks/components/day-agenda.test.tsx`

**Interfaces:**
- Consumes: `computeOrderBetween` (Task 2), `useDragToReorder` (Task 3), `actions.setOrder` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/components/day-agenda.test.tsx`, as a new top-level `describe` block after the existing ones:

```tsx
describe("DayAgenda reorder handle", () => {
  it("shows a reorder handle on All Day To-Do cards, but not Next Up or Done Today", async () => {
    const todo = makeTask({ id: "t", title: "todo item", scope: { kind: "day", date: ANCHOR } });
    const timed = makeTask({
      id: "n",
      title: "next item",
      time: "10:00",
      scope: { kind: "day", date: ANCHOR },
    });
    const done = makeTask({
      id: "d",
      title: "done item",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [todo, timed, done]);
    await waitFor(() => expect(screen.getByText("todo item")).toBeTruthy());
    expect(screen.getByLabelText("Reorder todo item")).toBeTruthy();
    expect(screen.queryByLabelText("Reorder next item")).toBeNull();
    expect(screen.queryByLabelText("Reorder done item")).toBeNull();
  });

  it("sorts All Day To-Do by order", async () => {
    const second = makeTask({ id: "s", title: "second", order: 2, scope: { kind: "day", date: ANCHOR } });
    const first = makeTask({ id: "f", title: "first", order: 1, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [second, first]);
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("first");
    expect(items[1]).toContain("second");
  });

  it("dragging the handle reorders All Day To-Do and persists the new order", async () => {
    const first = makeTask({ id: "f", title: "first", order: 1, scope: { kind: "day", date: ANCHOR } });
    const second = makeTask({ id: "s", title: "second", order: 2, scope: { kind: "day", date: ANCHOR } });
    const repo = fakeRepository([first, second]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda date={ANCHOR} agendaZoneRef={{ current: null }} getDragHandlers={noopGetDragHandlers} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());

    const handleFirst = screen.getByLabelText("Reorder first");
    const cardFirst = screen.getByTestId("agenda-f");
    const cardSecond = screen.getByTestId("agenda-s");
    vi.spyOn(cardFirst, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardSecond, "getBoundingClientRect").mockReturnValue({
      top: 50, bottom: 100, left: 0, right: 100, width: 100, height: 50, x: 0, y: 50, toJSON: () => {},
    } as DOMRect);

    fireEvent.pointerDown(handleFirst, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleFirst, { pointerId: 1, clientX: 10, clientY: 90 }); // past second's midpoint
    fireEvent.pointerUp(handleFirst, { pointerId: 1, clientX: 10, clientY: 90 });

    await waitFor(() => expect(repo.tasks.find((t) => t.id === "f")?.order).toBeGreaterThan(2));
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("second");
    expect(items[1]).toContain("first");
  });

  it("a handle-drag does not also trigger the existing drag-to-schedule gesture on the same card", async () => {
    const onScheduleSpy = vi.fn();
    const getDragHandlers = () => ({
      onPointerDown: onScheduleSpy,
      onPointerMove: () => {},
      onPointerUp: () => {},
      onPointerCancel: () => {},
      onClickCapture: () => {},
    });
    const t = makeTask({ id: "t", title: "todo item", scope: { kind: "day", date: ANCHOR } });
    render(
      <TasksProvider repository={fakeRepository([t])} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda date={ANCHOR} agendaZoneRef={{ current: null }} getDragHandlers={getDragHandlers} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("todo item")).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText("Reorder todo item"), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    expect(onScheduleSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: FAIL — `getByLabelText("Reorder todo item")` finds nothing (no handle exists yet), and the sort test fails because "All Day To-Do" isn't sorted by `order`.

- [ ] **Step 3: Wire the handle**

In `frontend/src/features/tasks/components/day-agenda.tsx`, replace the entire file with:

```tsx
"use client";

import { GripVertical } from "lucide-react";
import { useRef } from "react";

import { todayKey } from "../lib/dates";
import { computeOrderBetween } from "../lib/reorder";
import { compareTasksForDay, isPastToday, nowTime } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import { useDragToReorder } from "./use-drag-to-reorder";

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

  const allDayToDo = [...dayTasks.filter((t) => !t.time && !t.done)].sort(
    (a, b) => a.order - b.order,
  );
  const nextUp = [...dayTasks.filter((t) => !!t.time && !t.done)].sort(compareTasksForDay);
  const doneToday = dayTasks.filter((t) => t.done);

  const today = todayKey();
  const isViewingToday = date === today;
  const currentTime = nowTime();

  const reorderItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function handleReorder(id: string, insertBeforeId: string | null) {
    if (id === insertBeforeId) return;
    const dragged = allDayToDo.find((t) => t.id === id);
    if (!dragged) return;
    const remaining = allDayToDo.filter((t) => t.id !== id);
    const targetIndex =
      insertBeforeId === null ? remaining.length : remaining.findIndex((t) => t.id === insertBeforeId);
    if (targetIndex === -1) return;
    const before = remaining[targetIndex - 1]?.order;
    const after = remaining[targetIndex]?.order;
    const newOrder = computeOrderBetween(before, after);
    if (newOrder === dragged.order) return;
    actions.setOrder(id, newOrder);
  }

  const { dragState: reorderDragState, getDragHandlers: getReorderHandlers } = useDragToReorder({
    itemRefs: reorderItemRefs,
    orderedIds: allDayToDo.map((t) => t.id),
    onReorder: handleReorder,
  });

  function renderCard(t: Task, highlight?: "overdue" | "pending", reorderable = false) {
    return (
      <div key={t.id}>
        {reorderable && reorderDragState?.insertBeforeId === t.id && (
          <div data-testid="reorder-indicator" className="h-0.5 rounded-full bg-brand" />
        )}
        <div
          ref={
            reorderable
              ? (el) => {
                  reorderItemRefs.current[t.id] = el;
                }
              : undefined
          }
          data-testid={`agenda-${t.id}`}
          className="flex touch-none items-center gap-1.5"
          {...getDragHandlers(t.id, t.title)}
        >
          {reorderable && (
            <button
              type="button"
              aria-label={`Reorder ${t.title}`}
              className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
              {...getReorderHandlers(t.id, t.title)}
            >
              <GripVertical className="size-4" />
            </button>
          )}
          <ul className="min-w-0 flex-1">
            <TaskItem
              task={t}
              size="large"
              highlight={highlight}
              {...taskItemHandlers(t.id, actions)}
              onSelect={onSelectTask && (() => onSelectTask(t.id))}
            />
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={agendaZoneRef}
      data-testid="day-agenda"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card/50"
    >
      <div
        data-testid="day-agenda-scroll"
        className="min-h-0 flex-1 space-y-10 overflow-y-auto p-10"
      >
        {allDayToDo.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                All Day To-Do
              </h3>
              <span
                aria-label={`All Day To-Do: ${allDayToDo.length}`}
                className="text-xs font-semibold tabular-nums text-brand"
              >
                {allDayToDo.length}
              </span>
            </div>
            <div className="space-y-3">
              {allDayToDo.map((t) => renderCard(t, undefined, true))}
              {reorderDragState && reorderDragState.insertBeforeId === null && (
                <div data-testid="reorder-indicator" className="h-0.5 rounded-full bg-brand" />
              )}
            </div>
          </section>
        )}
        {nextUp.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Next Up
              </h3>
            </div>
            <div className="space-y-3">
              {nextUp.map((t) =>
                renderCard(
                  t,
                  isViewingToday
                    ? isPastToday(t.time!, date, today, currentTime, t.durationMinutes)
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
            <div className="mb-4 flex shrink-0 items-center gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Done Today
              </h3>
            </div>
            <div className="space-y-3">{doneToday.map((t) => renderCard(t))}</div>
          </section>
        )}
      </div>
      <div
        data-testid="day-agenda-footer"
        className="shrink-0 border-t border-border bg-card p-6"
      >
        <QuickAdd
          onAdd={(title) => addTask(title, scope)}
          onAddAndOpen={
            onSelectTask &&
            ((title) => {
              const created = addTask(title, scope);
              if (created) onSelectTask(created.id);
            })
          }
          placeholder="New task"
          ariaLabel="Add task"
          variant="panel-footer"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/day-agenda.test.tsx`
Expected: PASS — every test in the file, including the four new ones and every pre-existing test (the `closest("li")` DOM-structure assertions in the "same-day overdue highlighting" tests are unaffected, since `TaskItem`'s own internal `<li>` markup — reached from inside the new wrapper — is untouched).

- [ ] **Step 5: Run the whole frontend suite and typecheck once more**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-agenda.test.tsx
git commit -m "feat: add a drag handle to All Day To-Do cards for manual reordering"
```
