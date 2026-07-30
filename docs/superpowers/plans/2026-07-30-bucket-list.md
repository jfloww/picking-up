# Bucket List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Bucket List" view — tasks grouped by a free-text category (To Go, To Eat, To Do, ...), with no schedule — reusing the existing `Task` model, store, sync path, and `TaskDetailDrawer`.

**Architecture:** A new `Scope` variant `{ kind: "bucket"; category: string }` stored in the backend's existing generic `scope_kind`/`scope_value` columns (widened `scope_value`, no new column). Categories are derived from tasks currently using them (no `Category` table) via a new pure-function module. A new view composes stacked category sections built from a compact row component that mirrors the already-shipped `DrawerSubtaskRow` pattern.

**Tech Stack:** Next.js 15 / React 19 (existing), Django 5 / DRF (existing) — no new dependencies.

Spec: `docs/superpowers/specs/2026-07-30-bucket-list-design.md`

## Global Constraints

- No new `Category` database table, no new persistence layer, no second sync path — every mutation goes through the existing `repo.create`/`repo.update` used by every other store action.
- Category input is normalized: trimmed, empty rejected, case-insensitive match reuses the *existing* category's display casing.
- Categories are ordered by the earliest `createdAt` among their current tasks — not alphabetically.
- Within a category: active tasks first, completed below, both in stable creation order.
- Bucket-scoped tasks must not leak into Daily/Weekly/Monthly filtering, rollover, or routine materialization — every one of those already filters by exact positive `scope.kind` matching (verified during spec research), so this holds by construction; still gets an explicit regression test.
- Hide Start/Duration/Repeat in `TaskDetailDrawer` for a bucket-scoped task. Keep Due date, Priority, Background, Subtasks, Notes, completion, Delete/Cancel/Done — all unchanged.
- Blue = current/selected state. Amber = creation, and only ever as a subtle hover/focus accent here (never a filled CTA — that stays reserved for the global Add Task control, untouched by this plan).
- No task row anywhere in this app currently supports inline title editing (confirmed: neither `TaskItem` nor `TaskDetailDrawer` has one) — bucket item rows don't invent it either. Clicking a row's title opens `TaskDetailDrawer`, matching how every other task row already works.
- Reuse the compact-row visual language already shipped for Subtasks (`subtask-list.tsx`'s `DrawerSubtaskRow`): ~40px cardless rows, `hover:bg-muted/40`, hover/focus-revealed actions, `duration-200` transitions, `focus-visible:ring-2 focus-visible:ring-ring/50` focus rings.
- Don't touch Daily/Weekly/Monthly views, or anything about the drawer beyond what's needed to support a bucket-scoped task.

---

### Task 1: Backend — `bucket` scope kind and a wide-enough `scope_value`

**Files:**
- Modify: `backend/apps/tasks/models.py`
- Create: `backend/apps/tasks/migrations/0003_bucket_scope_and_wider_scope_value.py`
- Modify: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `scope_kind` accepts `"bucket"` as a valid choice. `scope_value` accepts strings up to 60 chars (was 20). No serializer changes needed — `TaskSerializer` doesn't declare `scope_kind`/`scope_value` explicitly, so DRF regenerates their validation from the model automatically (confirmed by reading `serializers.py`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/tasks/tests.py` (add this test class at the end of the file):

```python
class BucketScopeTests(TestCase):
    def test_creates_and_fetches_a_bucket_scoped_task(self):
        owner, client = auth_client("bucket@example.com")
        payload = make_task_payload(
            scope_kind="bucket",
            scope_value="Restaurants to try before I leave Tokyo",  # 40 chars, > old 20-char limit
        )
        response = client.post("/api/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["scope_kind"], "bucket")
        self.assertEqual(response.data["scope_value"], "Restaurants to try before I leave Tokyo")

        get_response = client.get("/api/tasks/")
        self.assertEqual(get_response.data[0]["scope_value"], "Restaurants to try before I leave Tokyo")

    def test_updates_a_task_from_one_category_to_another(self):
        owner, client = auth_client("bucket-update@example.com")
        payload = make_task_payload(scope_kind="bucket", scope_value="To Go")
        create_response = client.post("/api/tasks/", payload, format="json")
        task_id = create_response.data["id"]

        payload["scope_value"] = "To Eat"
        update_response = client.put(f"/api/tasks/{task_id}/", payload, format="json")
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["scope_value"], "To Eat")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.BucketScopeTests -v 2`
Expected: FAIL — `400` responses, since `"bucket"` isn't yet a valid `scope_kind` choice and `scope_value` is too short a column for the 40-char test value.

- [ ] **Step 3: Update the model**

In `backend/apps/tasks/models.py`, change:

```python
SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
]
```

to:

```python
SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("bucket", "bucket"),
]
```

And change:

```python
    scope_value = models.CharField(max_length=20)
```

to:

```python
    scope_value = models.CharField(max_length=60)
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py makemigrations tasks`
Expected: creates `apps/tasks/migrations/0003_alter_task_rolled_from_kind_alter_task_scope_kind_and_more.py` (exact filename may vary slightly) with three `AlterField` operations — `rolled_from_kind` and `scope_kind` (both share `choices=SCOPE_KIND_CHOICES`, so both get touched when it changes — metadata only, no real schema effect) and `scope_value` (a real `ALTER COLUMN` to widen it).

Rename the generated file to `0003_bucket_scope_and_wider_scope_value.py` for a clearer migration history (`git mv` if the tool already wrote it, or just save it under that name).

- [ ] **Step 5: Apply the migration and run the tests to verify they pass**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py migrate`
Expected: applies `apps.tasks.0003_bucket_scope_and_wider_scope_value` cleanly.

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2`
Expected: PASS — every test in the file, including the two new `BucketScopeTests`.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/tasks/models.py backend/apps/tasks/migrations/0003_bucket_scope_and_wider_scope_value.py backend/apps/tasks/tests.py
git commit -m "feat: add a bucket scope kind and widen scope_value for free-text categories"
```

---

### Task 2: Frontend — `Scope` type, `scopeKey`, API mapping, legacy-repository validation

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Create: `frontend/src/features/tasks/types.test.ts`
- Modify: `frontend/src/features/tasks/api/mapping.ts`
- Modify: `frontend/src/features/tasks/api/mapping.test.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/lib/times.test.ts`

**Interfaces:**
- Consumes: nothing new (Task 1 is a separate backend deploy; this task doesn't require the backend to be updated to compile or pass its own tests, since it exercises only the frontend serialization layer).
- Produces: `Scope` includes `{ kind: "bucket"; category: string }` — every later task imports this from `../types` (or `../../types` from `components/views/`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { scopeKey } from "./types";

describe("scopeKey", () => {
  it("returns a distinct key per scope kind", () => {
    expect(scopeKey({ kind: "day", date: "2026-07-16" })).toBe("day:2026-07-16");
    expect(scopeKey({ kind: "week", weekStart: "2026-07-12" })).toBe("week:2026-07-12");
    expect(scopeKey({ kind: "month", month: "2026-07" })).toBe("month:2026-07");
    expect(scopeKey({ kind: "year", year: "2026" })).toBe("year:2026");
  });

  it("returns a category-based key for a bucket scope", () => {
    expect(scopeKey({ kind: "bucket", category: "To Eat" })).toBe("bucket:To Eat");
  });
});
```

Append to `frontend/src/features/tasks/api/mapping.test.ts` (find the existing `it("round-trips a year-scoped task", ...)` test and add this one after it):

```ts
  it("round-trips a bucket-scoped task", () => {
    const bucketTask: Task = {
      id: "b1",
      title: "try that new ramen place",
      done: false,
      scope: { kind: "bucket", category: "To Eat" },
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    expect(fromApiPayload(toApiPayload(bucketTask))).toEqual(bucketTask);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/types.test.ts src/features/tasks/api/mapping.test.ts`
Expected: FAIL — `types.test.ts` fails with a TypeScript error (`"bucket"` isn't a valid `Scope` kind yet) surfaced as a test failure; the new `mapping.test.ts` case fails the same way.

- [ ] **Step 3: Extend the `Scope` union and `scopeKey`**

In `frontend/src/features/tasks/types.ts`, change:

```ts
export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string };
```

to:

```ts
export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string }
  | { kind: "bucket"; category: string };
```

And in the same file, change `scopeKey`:

```ts
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return `day:${scope.date}`;
    case "week":
      return `week:${scope.weekStart}`;
    case "month":
      return `month:${scope.month}`;
    case "year":
      return `year:${scope.year}`;
  }
}
```

to:

```ts
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return `day:${scope.date}`;
    case "week":
      return `week:${scope.weekStart}`;
    case "month":
      return `month:${scope.month}`;
    case "year":
      return `year:${scope.year}`;
    case "bucket":
      return `bucket:${scope.category}`;
  }
}
```

- [ ] **Step 4: Extend `mapping.ts`'s two exhaustive switches**

In `frontend/src/features/tasks/api/mapping.ts`, find `scopeValueOf`:

```ts
function scopeValueOf(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return scope.date;
    case "week":
      return scope.weekStart;
    case "month":
      return scope.month;
    case "year":
      return scope.year;
  }
}
```

Add a case:

```ts
function scopeValueOf(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return scope.date;
    case "week":
      return scope.weekStart;
    case "month":
      return scope.month;
    case "year":
      return scope.year;
    case "bucket":
      return scope.category;
  }
}
```

Find `scopeFromParts`:

```ts
function scopeFromParts(kind: ScopeKind, value: string): Scope {
  switch (kind) {
    case "day":
      return { kind: "day", date: value };
    case "week":
      return { kind: "week", weekStart: value };
    case "month":
      return { kind: "month", month: value };
    case "year":
      return { kind: "year", year: value };
  }
}
```

Add a case:

```ts
function scopeFromParts(kind: ScopeKind, value: string): Scope {
  switch (kind) {
    case "day":
      return { kind: "day", date: value };
    case "week":
      return { kind: "week", weekStart: value };
    case "month":
      return { kind: "month", month: value };
    case "year":
      return { kind: "year", year: value };
    case "bucket":
      return { kind: "bucket", category: value };
  }
}
```

`ScopeKind` (near the top of `mapping.ts`, typed as a union of string literals mirroring the backend's choices) needs `"bucket"` added too — find its definition and add it the same way as the other four.

- [ ] **Step 5: Complete the legacy-repository validator**

In `frontend/src/features/tasks/data/repository.ts`, change:

```ts
const SCOPE_FIELDS = {
  day: "date",
  week: "weekStart",
  month: "month",
  year: "year",
} as const;
```

to:

```ts
const SCOPE_FIELDS = {
  day: "date",
  week: "weekStart",
  month: "month",
  year: "year",
  bucket: "category",
} as const;
```

This one's unreachable in practice today (nothing bucket-scoped could exist in pre-migration localStorage data before this feature ships), but keeps this validator's allowlist complete and consistent with every other exhaustive scope mapping in the codebase rather than silently missing one kind.

- [ ] **Step 6: Write and run the no-leakage regression test**

This test should pass immediately with no further code changes — it's confirming, not driving, behavior: every existing scope filter already uses exact positive `scope.kind` matching (verified during spec research), so a new `"bucket"` kind is excluded by construction. Append to `frontend/src/features/tasks/lib/times.test.ts`:

```ts
describe("bucket-scoped tasks don't leak into day/week/month filters", () => {
  it("is excluded from weekStats and monthStats", () => {
    const bucketTask = makeTask({
      id: "b1",
      done: false,
      scope: { kind: "bucket", category: "To Eat" },
    });
    expect(weekStats([bucketTask], "2026-07-12")).toEqual({ total: 0, done: 0 });
    expect(monthStats([bucketTask], "2026-07")).toEqual({ total: 0, done: 0 });
  });

  it("is excluded from dayTasksForWeek", () => {
    const bucketTask = makeTask({
      id: "b1",
      scope: { kind: "bucket", category: "To Eat" },
    });
    expect(dayTasksForWeek([bucketTask], "2026-07-16", "2026-07-12")).toEqual([]);
  });
});
```

(Add `weekStats`, `monthStats`, `dayTasksForWeek`, and `makeTask` to that file's existing imports if they aren't already imported — check the top of `times.test.ts` first, most are likely already there for the other describe blocks in the same file.)

Run: `cd frontend && npx vitest run src/features/tasks/lib/times.test.ts`
Expected: PASS immediately, no implementation step needed — this is what "excluded by construction" means in practice.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/types.test.ts src/features/tasks/api/mapping.test.ts`
Expected: PASS — all cases, including the two new ones.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (This is the real safety net for this task — every other exhaustive `switch (scope.kind)` in the codebase that isn't listed above would now fail to compile if one exists; a clean `tsc` run confirms there are none left unhandled.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/types.test.ts frontend/src/features/tasks/api/mapping.ts frontend/src/features/tasks/api/mapping.test.ts frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/lib/times.test.ts
git commit -m "feat: add a bucket Scope kind to the frontend type system and API mapping"
```

---

### Task 3: Category grouping and normalization (`lib/categories.ts`)

**Files:**
- Create: `frontend/src/features/tasks/lib/categories.ts`
- Create: `frontend/src/features/tasks/lib/categories.test.ts`

**Interfaces:**
- Consumes: `Task`, `Scope` from `../types` (Task 2).
- Produces: `normalizeCategoryInput(input: string): string`, `resolveCategoryCasing(input: string, existingCategories: string[]): string`, `BucketCategoryGroup` (`{ category: string; active: Task[]; completed: Task[] }`), `groupBucketTasks(tasks: Task[]): BucketCategoryGroup[]`, `bucketCategoriesInUse(tasks: Task[]): string[]`. Task 4 (store) imports `resolveCategoryCasing` and `bucketCategoriesInUse`. Task 6/7 (views) import `groupBucketTasks`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/lib/categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  bucketCategoriesInUse,
  groupBucketTasks,
  normalizeCategoryInput,
  resolveCategoryCasing,
} from "./categories";
import { makeTask } from "../test-utils";

describe("normalizeCategoryInput", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeCategoryInput("  To Eat  ")).toBe("To Eat");
  });
});

describe("resolveCategoryCasing", () => {
  it("returns the trimmed input when there's no existing match", () => {
    expect(resolveCategoryCasing("  To Go  ", ["To Eat"])).toBe("To Go");
  });

  it("reuses the existing category's casing on a case-insensitive match", () => {
    expect(resolveCategoryCasing("to eat", ["To Eat"])).toBe("To Eat");
    expect(resolveCategoryCasing("TO EAT", ["To Eat"])).toBe("To Eat");
  });
});

describe("groupBucketTasks", () => {
  it("excludes tasks that aren't bucket-scoped", () => {
    const dayTask = makeTask({ id: "d1", scope: { kind: "day", date: "2026-07-16" } });
    expect(groupBucketTasks([dayTask])).toEqual([]);
  });

  it("groups tasks by category, active before completed, in stable creation order", () => {
    const tasks = [
      makeTask({
        id: "1",
        title: "ramen",
        done: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
      makeTask({
        id: "2",
        title: "sushi",
        done: false,
        createdAt: "2026-07-02T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
      makeTask({
        id: "3",
        title: "tacos",
        done: false,
        createdAt: "2026-07-03T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
    ];
    const [group] = groupBucketTasks(tasks);
    expect(group.category).toBe("To Eat");
    expect(group.active.map((t) => t.id)).toEqual(["2", "3"]);
    expect(group.completed.map((t) => t.id)).toEqual(["1"]);
  });

  it("orders categories by the earliest createdAt among their own tasks, not alphabetically", () => {
    const tasks = [
      makeTask({
        id: "1",
        createdAt: "2026-07-05T00:00:00.000Z",
        scope: { kind: "bucket", category: "Zzz Later" },
      }),
      makeTask({
        id: "2",
        createdAt: "2026-07-01T00:00:00.000Z",
        scope: { kind: "bucket", category: "Aaa Sooner" },
      }),
    ];
    const groups = groupBucketTasks(tasks);
    expect(groups.map((g) => g.category)).toEqual(["Aaa Sooner", "Zzz Later"]);
  });
});

describe("bucketCategoriesInUse", () => {
  it("returns the distinct category names in group order", () => {
    const tasks = [
      makeTask({ id: "1", createdAt: "2026-07-01T00:00:00.000Z", scope: { kind: "bucket", category: "To Go" } }),
      makeTask({ id: "2", createdAt: "2026-07-02T00:00:00.000Z", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "3", createdAt: "2026-07-03T00:00:00.000Z", scope: { kind: "bucket", category: "To Go" } }),
    ];
    expect(bucketCategoriesInUse(tasks)).toEqual(["To Go", "To Eat"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/lib/categories.test.ts`
Expected: FAIL — cannot find module `./categories` (doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/features/tasks/lib/categories.ts`:

```ts
import type { Task } from "../types";

export function normalizeCategoryInput(input: string): string {
  return input.trim();
}

// Case-insensitive match against categories already in use; returns the
// EXISTING display casing on a match, or the trimmed input if it's new —
// so "to eat" typed against an existing "To Eat" reuses "To Eat" rather
// than creating a second, differently-cased category.
export function resolveCategoryCasing(input: string, existingCategories: string[]): string {
  const trimmed = normalizeCategoryInput(input);
  const existing = existingCategories.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  return existing ?? trimmed;
}

export interface BucketCategoryGroup {
  category: string;
  active: Task[];
  completed: Task[];
}

// One entry per distinct category among bucket-scoped tasks, ordered by the
// earliest createdAt among that category's own tasks (not alphabetical).
// Within each group: active tasks first, completed below, both in stable
// creation order.
export function groupBucketTasks(tasks: Task[]): BucketCategoryGroup[] {
  const bucketTasks = tasks.filter(
    (t): t is Task & { scope: { kind: "bucket"; category: string } } => t.scope.kind === "bucket",
  );

  const byCategory = new Map<string, Task[]>();
  for (const t of bucketTasks) {
    const list = byCategory.get(t.scope.category) ?? [];
    list.push(t);
    byCategory.set(t.scope.category, list);
  }

  const withOrderKey = Array.from(byCategory.entries()).map(([category, items]) => {
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      category,
      active: sorted.filter((t) => !t.done),
      completed: sorted.filter((t) => t.done),
      earliestCreatedAt: sorted[0].createdAt,
    };
  });

  withOrderKey.sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));

  return withOrderKey.map(({ category, active, completed }) => ({ category, active, completed }));
}

export function bucketCategoriesInUse(tasks: Task[]): string[] {
  return groupBucketTasks(tasks).map((g) => g.category);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/lib/categories.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/categories.ts frontend/src/features/tasks/lib/categories.test.ts
git commit -m "feat: add bucket-list category normalization and grouping"
```

---

### Task 4: Store actions — `addBucketItem`, `setCategory`

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: `resolveCategoryCasing`, `bucketCategoriesInUse` from `./lib/categories` (Task 3).
- Produces: `TasksContextValue.addBucketItem(title: string, category: string): Task | undefined`, `TasksContextValue.setCategory(id: string, category: string): void`. Task 5 (drawer) uses `setCategory`. Task 7 (view) uses `addBucketItem`.

- [ ] **Step 1: Write the failing tests**

Find the existing `describe("time and subtask actions", ...)` block's closing (or any convenient top-level spot) in `frontend/src/features/tasks/store.test.tsx` and add:

```ts
describe("bucket list actions", () => {
  it("addBucketItem trims the title, normalizes category casing, and rejects a blank title or category", async () => {
    const existing = makeTask({
      id: "existing",
      scope: { kind: "bucket", category: "To Eat" },
    });
    const { repo, result } = setup(fakeRepository([existing]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addBucketItem("  try the new ramen place  ", "to eat"); // case-insensitive match
    });
    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    const created = result.current.tasks.find((t) => t.id !== "existing")!;
    expect(created.title).toBe("try the new ramen place");
    expect(created.scope).toEqual({ kind: "bucket", category: "To Eat" }); // reused existing casing
    await waitFor(() => expect(repo.tasks).toHaveLength(2));

    act(() => result.current.addBucketItem("   ", "To Go"));
    expect(result.current.tasks).toHaveLength(2); // blank title rejected

    act(() => result.current.addBucketItem("valid title", "   "));
    expect(result.current.tasks).toHaveLength(2); // blank category rejected
  });

  it("setCategory moves a task to a new category, persisting the change", async () => {
    const task = makeTask({ id: "a", scope: { kind: "bucket", category: "To Go" } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setCategory("a", "To Eat"));
    expect(result.current.tasks[0].scope).toEqual({ kind: "bucket", category: "To Eat" });
    await waitFor(() => expect(repo.tasks[0].scope).toEqual({ kind: "bucket", category: "To Eat" }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx -t "bucket list actions"`
Expected: FAIL — `result.current.addBucketItem is not a function`.

- [ ] **Step 3: Add the store actions**

In `frontend/src/features/tasks/store.tsx`, add the import:

```ts
import { bucketCategoriesInUse, resolveCategoryCasing } from "./lib/categories";
```

Add to the `TasksContextValue` interface (alongside `addTask`/`setDueDate`):

```ts
  addBucketItem: (title: string, category: string) => Task | undefined;
  setCategory: (id: string, category: string) => void;
```

Add the two actions inside the `useMemo<TasksContextValue>(() => ({ ...state, ... }))` object literal, next to `addTask`:

```ts
      addBucketItem(title, category) {
        const trimmed = title.trim();
        const normalizedCategory = resolveCategoryCasing(category, bucketCategoriesInUse(state.tasks));
        if (!trimmed || !normalizedCategory) return undefined;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope: { kind: "bucket", category: normalizedCategory },
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
      setCategory(id, category) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current || current.scope.kind !== "bucket") return;
        const trimmed = category.trim();
        if (!trimmed) return;
        const task: Task = { ...current, scope: { kind: "bucket", category: trimmed } };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS — the full file, including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: add addBucketItem and setCategory store actions"
```

---

### Task 5: Drawer support for bucket-scoped tasks

**Files:**
- Create: `frontend/src/features/tasks/components/task-category-editor.tsx`
- Create: `frontend/src/features/tasks/components/task-category-editor.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks besides `Scope`/`Task` (Task 2) and the `setCategory` store action (Task 4, wired via `taskItemHandlers`).
- Produces: `TaskCategoryEditor` (new component). `TaskDetailFields` gains `bucketCategories?: string[]` (default `[]`) and `onCategoryChange?: (category: string) => void`. `TaskDetailDrawer` gains the same two props, passed straight through, plus buffers category edits the same way every other field is buffered. `taskItemHandlers` gains `onCategoryChange`. Task 7 (view) passes `bucketCategories` into `TaskDetailDrawer` and relies on `taskItemHandlers`'s spread for `onCategoryChange` — it does not need to wire that prop itself.

- [ ] **Step 1: Write the failing tests for `TaskCategoryEditor`**

Create `frontend/src/features/tasks/components/task-category-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskCategoryEditor } from "./task-category-editor";

describe("TaskCategoryEditor", () => {
  it("shows the current category as the input's value", () => {
    render(<TaskCategoryEditor category="To Eat" categories={["To Eat", "To Go"]} onCategoryChange={() => {}} />);
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("To Eat");
  });

  it("suggests existing categories via a datalist, not a hard cap", () => {
    render(<TaskCategoryEditor category="To Eat" categories={["To Eat", "To Go"]} onCategoryChange={() => {}} />);
    const input = screen.getByLabelText("Category") as HTMLInputElement;
    const datalist = document.getElementById(input.list!.id) as HTMLDataListElement;
    const options = Array.from(datalist.options).map((o) => o.value);
    expect(options).toEqual(["To Eat", "To Go"]);
  });

  it("commits a trimmed value on blur, not on every keystroke", () => {
    const onCategoryChange = vi.fn();
    render(<TaskCategoryEditor category="To Eat" categories={[]} onCategoryChange={onCategoryChange} />);
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "  To Read  " } });
    expect(onCategoryChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCategoryChange).toHaveBeenCalledWith("To Read");
  });

  it("does not call onCategoryChange on blur when the value is unchanged", () => {
    const onCategoryChange = vi.fn();
    render(<TaskCategoryEditor category="To Eat" categories={[]} onCategoryChange={onCategoryChange} />);
    fireEvent.blur(screen.getByLabelText("Category"));
    expect(onCategoryChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-category-editor.test.tsx`
Expected: FAIL — cannot find module `./task-category-editor` (doesn't exist yet).

- [ ] **Step 3: Write `TaskCategoryEditor`**

Create `frontend/src/features/tasks/components/task-category-editor.tsx`:

```tsx
"use client";

import { useId } from "react";

export function TaskCategoryEditor({
  category,
  categories,
  onCategoryChange,
}: {
  category: string;
  categories: string[];
  onCategoryChange: (category: string) => void;
}) {
  const listId = useId();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-subtle">Category</span>
      <input
        type="text"
        list={listId}
        defaultValue={category}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed && trimmed !== category) onCategoryChange(trimmed);
        }}
        aria-label="Category"
        className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-category-editor.test.tsx`
Expected: PASS — all four cases.

- [ ] **Step 5: Write the failing tests for `TaskDetailFields`**

Append to `frontend/src/features/tasks/components/task-detail-fields.test.tsx`:

```tsx
describe("TaskDetailFields bucket category", () => {
  it("shows the Category field for a bucket-scoped task", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "bucket", category: "To Eat" } })}
        {...noopHandlers}
        bucketCategories={["To Eat", "To Go"]}
        onCategoryChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("To Eat");
  });

  it("hides the Category field for a non-bucket task", () => {
    render(<TaskDetailFields task={makeTask({})} {...noopHandlers} />);
    expect(screen.queryByLabelText("Category")).toBeNull();
  });

  it("hides Start/Duration for a bucket-scoped task even when showTime is true", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "bucket", category: "To Do" }, time: "09:00" })}
        {...noopHandlers}
        showTime
      />,
    );
    expect(screen.queryByLabelText("Task time")).toBeNull();
  });

  it("hides Repeat for a bucket-scoped task", () => {
    render(
      <TaskDetailFields task={makeTask({ scope: { kind: "bucket", category: "To Do" } })} {...noopHandlers} />,
    );
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
  });

  it("still shows Due date, Priority, and Background for a bucket-scoped task", () => {
    render(
      <TaskDetailFields task={makeTask({ scope: { kind: "bucket", category: "To Do" } })} {...noopHandlers} />,
    );
    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Priority" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Background" })).toBeTruthy();
  });

  it("calls onCategoryChange when the category is edited", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "bucket", category: "To Eat" } })}
        {...noopHandlers}
        bucketCategories={["To Eat"]}
        onCategoryChange={onCategoryChange}
      />,
    );
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "To Read" } });
    fireEvent.blur(input);
    expect(onCategoryChange).toHaveBeenCalledWith("To Read");
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx -t "bucket category"`
Expected: FAIL — Category field never renders (doesn't exist yet), Start/Duration/Repeat visibility for a bucket task isn't handled yet.

- [ ] **Step 7: Wire `TaskCategoryEditor` into `TaskDetailFields`**

In `frontend/src/features/tasks/components/task-detail-fields.tsx`, add the import:

```tsx
import { TaskCategoryEditor } from "./task-category-editor";
```

Add to the props destructuring and type:

```tsx
  bucketCategories = [],
  onCategoryChange,
```

```tsx
  bucketCategories?: string[];
  onCategoryChange?: (category: string) => void;
```

Inside `schedulingCluster`, find the Due-date section:

```tsx
      {!isRoutine && (
        <section className={cn(drawer && "space-y-2.5")}>
          <TaskDueDateEditor
            dueDate={task.dueDate}
            onDueDateChange={onDueDateChange}
            variant={variant}
          />
        </section>
      )}
```

Add the Category section directly after it (before the Priority/Background `<div>`):

```tsx
      {task.scope.kind === "bucket" && (
        <section className={cn(drawer && "space-y-2.5")}>
          <TaskCategoryEditor
            category={task.scope.category}
            categories={bucketCategories}
            onCategoryChange={(category) => onCategoryChange?.(category)}
          />
        </section>
      )}
```

Now hide Start/Duration/Repeat for a bucket task. `showRepeat` already evaluates `false` for a bucket scope with no code changes (`task.repeatWeekdays !== undefined || task.scope.kind === "day"` — both false), so nothing to do there. For `showTime`, find:

```tsx
      {showTime && (
        <TaskTimeEditor
```

Change to:

```tsx
      {showTime && task.scope.kind !== "bucket" && (
        <TaskTimeEditor
```

(This handles the case tested in Step 5 — `showTime` passed as `true` but the task is bucket-scoped, e.g. if a caller passed `showTime` explicitly without checking scope first. Task `TaskDetailDrawer`, in the next step, additionally passes `showTime={task.scope.kind !== "bucket"}`, so this is defense in depth, not the only guard.)

- [ ] **Step 8: Run the `TaskDetailFields` tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS — the full file, including the six new bucket-category tests.

- [ ] **Step 9: Write the failing tests for `TaskDetailDrawer`**

Append to `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`:

```tsx
describe("bucket-scoped task", () => {
  const bucketTask = makeTask({
    id: "bk",
    title: "try that new ramen place",
    scope: { kind: "bucket", category: "To Eat" },
  });

  it("hides Start, Duration, and Repeat", () => {
    render(<TaskDetailDrawer task={bucketTask} {...noopHandlers} />);
    expect(screen.queryByLabelText("Task time")).toBeNull();
    expect(screen.queryByLabelText("Task duration")).toBeNull();
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
  });

  it("still shows Due date, Priority, Background, Subtasks, and Notes", () => {
    render(<TaskDetailDrawer task={bucketTask} {...noopHandlers} />);
    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Priority" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Background" })).toBeTruthy();
    expect(screen.getByText("SUBTASKS")).toBeTruthy();
    expect(screen.getByText("Add a note…")).toBeTruthy();
  });

  it("shows the Category field and buffers edits until Done, like every other field", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskDetailDrawer
        task={bucketTask}
        {...noopHandlers}
        bucketCategories={["To Eat", "To Go"]}
        onCategoryChange={onCategoryChange}
      />,
    );
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "To Go" } });
    fireEvent.blur(input);
    expect(onCategoryChange).not.toHaveBeenCalled(); // buffered, not committed yet

    fireEvent.click(screen.getByText("Done"));
    expect(onCategoryChange).toHaveBeenCalledWith("To Go");
  });

  it("Cancel discards an edited category without calling onCategoryChange", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskDetailDrawer
        task={bucketTask}
        {...noopHandlers}
        bucketCategories={["To Eat", "To Go"]}
        onCategoryChange={onCategoryChange}
      />,
    );
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "To Go" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCategoryChange).not.toHaveBeenCalled();
  });
});
```

Add `onCategoryChange: (_category: string) => {}` to the file's `noopHandlers` object.

- [ ] **Step 10: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx -t "bucket-scoped task"`
Expected: FAIL — `onCategoryChange` prop doesn't exist on `TaskDetailDrawer` yet; Start/Duration/Repeat still render for a bucket task since the drawer doesn't pass `showTime` yet.

- [ ] **Step 11: Wire category buffering into `TaskDetailDrawer`**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`, add `category?: string` to the `Draft` interface:

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
  dueDate?: string;
  category?: string;
}
```

In `draftFromTask`, add:

```ts
    category: task.scope.kind === "bucket" ? task.scope.category : undefined,
```

Add `bucketCategories = []` and `onCategoryChange` to the component's props destructuring and type (`bucketCategories?: string[]`, `onCategoryChange?: (category: string) => void`).

Find where `draftTask` is constructed:

```tsx
  const { detached, ...draftFields } = draft;
  const draftTask: Task = {
    ...task,
    ...draftFields,
    repeatSourceId: detached ? undefined : task.repeatSourceId,
  };
```

`category` isn't a top-level `Task` field (it's nested in `scope`), so it needs to be excluded from the generic spread and folded into `scope` explicitly instead:

```tsx
  const { detached, category: draftCategory, ...draftFields } = draft;
  const draftScope: Scope =
    task.scope.kind === "bucket" && draftCategory !== undefined
      ? { kind: "bucket", category: draftCategory }
      : task.scope;
  const draftTask: Task = {
    ...task,
    ...draftFields,
    scope: draftScope,
    repeatSourceId: detached ? undefined : task.repeatSourceId,
  };
```

Add the `Scope` import: `import type { Scope, Task } from "../types";` (find the existing `import type { Task } from "../types";` and extend it).

In `handleDone`, find:

```tsx
    if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);
```

Add directly after it:

```tsx
    if (
      task.scope.kind === "bucket" &&
      draft.category !== undefined &&
      draft.category !== task.scope.category
    ) {
      onCategoryChange?.(draft.category);
    }
```

Find where `<TaskDetailFields ... />` is rendered and add:

```tsx
          bucketCategories={bucketCategories}
          onCategoryChange={(category) => setDraft((d) => ({ ...d, category }))}
          showTime={task.scope.kind !== "bucket"}
```

(`showTime` wasn't passed at all before — it defaulted to `true`. This is the primary guard for hiding Start/Duration on a bucket task; the `task.scope.kind !== "bucket"` check added to `TaskDetailFields` itself in Step 7 is the defense-in-depth backstop.)

- [ ] **Step 12: Run the `TaskDetailDrawer` tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: PASS — the full file, including the four new bucket-scoped-task tests.

- [ ] **Step 13: Thread `onCategoryChange` through `taskItemHandlers`**

In `frontend/src/features/tasks/components/task-item.tsx`, add to the `TaskItemActions` interface:

```ts
  setCategory: (id: string, category: string) => void;
```

In `taskItemHandlers`, add:

```ts
    onCategoryChange: (category: string) => actions.setCategory(id, category),
```

- [ ] **Step 14: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors. (`taskItemHandlers`'s callers in `daily-view.tsx`/`weekly-view.tsx`/`monthly-view.tsx` spread its full return value into `TaskDetailDrawer` already — they'll now also pass `onCategoryChange`, which `TaskDetailDrawer` accepts as optional and those views' tasks never trigger, so no other file needs to change.)

- [ ] **Step 15: Commit**

```bash
git add frontend/src/features/tasks/components/task-category-editor.tsx frontend/src/features/tasks/components/task-category-editor.test.tsx frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx frontend/src/features/tasks/components/task-item.tsx
git commit -m "feat: support bucket-scoped tasks in the Task Detail drawer"
```

---

### Task 6: `BucketItemRow` and `BucketCategorySection`

**Files:**
- Create: `frontend/src/features/tasks/components/bucket-item-row.tsx`
- Create: `frontend/src/features/tasks/components/bucket-category-section.tsx`
- Create: `frontend/src/features/tasks/components/bucket-category-section.test.tsx`

**Interfaces:**
- Consumes: `Task` from `../types` (Task 2); `dueDateLabel`/`isOverdue` from `../lib/dates` (existing); `QuickAdd` from `./quick-add` (existing).
- Produces: `BucketItemRow` (used only by `BucketCategorySection`, not exported for outside use). `BucketCategorySection` — props `category: string`, `active: Task[]`, `completed: Task[]`, `onToggle: (taskId: string) => void`, `onSelect: (taskId: string) => void`, `onDelete: (taskId: string) => void`, `onAddItem: (title: string) => void`. Task 7 (view) renders one `BucketCategorySection` per group.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/bucket-category-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { BucketCategorySection } from "./bucket-category-section";

describe("BucketCategorySection", () => {
  const active = [makeTask({ id: "a1", title: "sushi", done: false })];
  const completed = [makeTask({ id: "c1", title: "ramen", done: true })];

  it("shows the category name and an item count", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("To Eat")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("uses singular '1 item' for exactly one item", () => {
    render(
      <BucketCategorySection
        category="To Go"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("renders active items before completed items", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const titles = screen.getAllByText(/sushi|ramen/).map((el) => el.textContent);
    expect(titles).toEqual(["sushi", "ramen"]);
  });

  it("shows a completed item muted with strikethrough, not hidden", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={[]}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const title = screen.getByText("ramen");
    expect(title.className).toContain("line-through");
    expect(title.className).toContain("text-muted-foreground");
  });

  it("calls onToggle when a row's checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={onToggle}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    expect(onToggle).toHaveBeenCalledWith("a1");
  });

  it("calls onSelect when a row's title is clicked", () => {
    const onSelect = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={onSelect}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("sushi"));
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("calls onDelete from the row's hover-revealed delete control", () => {
    const onDelete = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={onDelete}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("shows a due-date badge when present, turning destructive when overdue and not done", () => {
    const overdue = [
      makeTask({ id: "o1", title: "renew passport", done: false, dueDate: "2020-01-01" }),
    ];
    render(
      <BucketCategorySection
        category="To Do"
        active={overdue}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const badge = screen.getByText(/Due/);
    expect(badge.className).toContain("text-destructive");
  });

  it("shows a Priority badge when present", () => {
    const priority = [makeTask({ id: "p1", title: "climb Fuji", priority: true })];
    render(
      <BucketCategorySection
        category="To Go"
        active={priority}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("has a per-category add-item row that calls onAddItem with the typed title", () => {
    const onAddItem = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={[]}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={onAddItem}
      />,
    );
    const input = screen.getByLabelText("Add item to To Eat");
    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAddItem).toHaveBeenCalledWith("ramen");
    expect((input as HTMLInputElement).value).toBe(""); // ready for the next entry
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/bucket-category-section.test.tsx`
Expected: FAIL — cannot find module `./bucket-category-section` (doesn't exist yet).

- [ ] **Step 3: Write `BucketItemRow`**

Create `frontend/src/features/tasks/components/bucket-item-row.tsx`:

```tsx
"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { dueDateLabel, isOverdue, todayKey } from "../lib/dates";
import type { Task } from "../types";

// Cardless ~40px row, deliberately mirroring subtask-list.tsx's
// DrawerSubtaskRow: checkbox, click target, hover/focus-revealed delete.
// Unlike a subtask row, the click target opens the Task Detail drawer
// rather than editing inline — bucket items are full Tasks with their own
// drawer, and no task row anywhere in this app currently supports inline
// title editing (confirmed: neither TaskItem nor the drawer's header has
// one), so this doesn't invent it just for bucket items either.
export function BucketItemRow({
  task,
  onToggle,
  onSelect,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const today = todayKey();
  const badgeClass = "shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground";

  return (
    <li className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
      <Checkbox
        checked={task.done}
        onCheckedChange={onToggle}
        aria-label={`Toggle ${task.title}`}
        className="shrink-0 border-subtle"
      />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          task.done && "text-muted-foreground line-through hover:text-muted-foreground",
        )}
      >
        {task.title}
      </button>
      {task.dueDate && (
        <span
          className={cn(
            badgeClass,
            isOverdue(task.dueDate, today) && !task.done && "bg-destructive/10 text-destructive",
          )}
        >
          {dueDateLabel(task.dueDate, today)}
        </span>
      )}
      {task.priority && <span className={badgeClass}>Priority</span>}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${task.title}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Write `BucketCategorySection`**

Create `frontend/src/features/tasks/components/bucket-category-section.tsx`:

```tsx
"use client";

import { Plus } from "lucide-react";

import type { Task } from "../types";
import { BucketItemRow } from "./bucket-item-row";
import { QuickAdd } from "./quick-add";

export function BucketCategorySection({
  category,
  active,
  completed,
  onToggle,
  onSelect,
  onDelete,
  onAddItem,
}: {
  category: string;
  active: Task[];
  completed: Task[];
  onToggle: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onAddItem: (title: string) => void;
}) {
  const total = active.length + completed.length;

  return (
    <section className="space-y-2 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          {category}
        </h3>
        <span className="text-[11px] font-medium text-subtle">
          {total} {total === 1 ? "item" : "items"}
        </span>
      </div>
      <ul>
        {[...active, ...completed].map((task) => (
          <BucketItemRow
            key={task.id}
            task={task}
            onToggle={() => onToggle(task.id)}
            onSelect={() => onSelect(task.id)}
            onDelete={() => onDelete(task.id)}
          />
        ))}
      </ul>
      <div className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 text-foreground/70 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
        <Plus
          className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-within:text-amber"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <QuickAdd onAdd={onAddItem} placeholder="Add item" ariaLabel={`Add item to ${category}`} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/bucket-category-section.test.tsx`
Expected: PASS — all eleven cases.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/bucket-item-row.tsx frontend/src/features/tasks/components/bucket-category-section.tsx frontend/src/features/tasks/components/bucket-category-section.test.tsx
git commit -m "feat: add BucketItemRow and BucketCategorySection"
```

---

### Task 7: `BucketListView` — page, general add composer, empty state

**Files:**
- Create: `frontend/src/features/tasks/components/views/bucket-list-view.tsx`
- Create: `frontend/src/features/tasks/components/views/bucket-list-view.test.tsx`

**Interfaces:**
- Consumes: `groupBucketTasks` (Task 3), `useTasks` (existing), `addBucketItem`/`setCategory`-bearing store (Task 4), `BucketCategorySection` (Task 6), `TaskDetailDrawer` + `taskItemHandlers` (existing, extended in Task 5), `CalendarViewProps` from `./weekly-view` (existing).
- Produces: `BucketListView` — a component matching `CalendarViewProps`, ready to be wired into `VIEW_COMPONENTS` in Task 8.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/views/bucket-list-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeRepository, makeTask } from "../../test-utils";
import { TasksProvider } from "../../store";
import { BucketListView } from "./bucket-list-view";

function renderView(tasks = [] as ReturnType<typeof makeTask>[]) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <BucketListView anchor="2026-07-16" onAnchorChange={() => {}} />
    </TasksProvider>,
  );
}

describe("BucketListView", () => {
  it("shows the empty state when there are no bucket tasks", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("Your bucket list is empty")).toBeTruthy());
    expect(screen.getByText("Add something you want to do, try, visit, or remember.")).toBeTruthy();
  });

  it("groups tasks by category and shows item counts", async () => {
    renderView([
      makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", category: "To Go" } }),
    ]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    expect(screen.getByText("To Go")).toBeTruthy();
    expect(screen.getByText("sushi")).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });

  it("completes and un-completes an item from its row", async () => {
    renderView([makeTask({ id: "1", title: "sushi", done: false, scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByLabelText("Toggle sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).toContain("line-through"));
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).not.toContain("line-through"));
  });

  it("deletes an item from its row", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("sushi")).toBeNull());
  });

  it("removes a category's whole section once its last item is deleted, keeping other categories", async () => {
    renderView([
      makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", category: "To Go" } }),
    ]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("To Eat")).toBeNull());
    expect(screen.getByText("To Go")).toBeTruthy(); // untouched
  });

  it("opens the Task Detail drawer when a row's title is clicked", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByText("sushi"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());
    expect(screen.queryByLabelText("Task time")).toBeNull(); // scheduling fields hidden
  });

  it("adds several items with Enter inside one category without losing focus", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByLabelText("Add item to To Eat")).toBeTruthy());
    const input = screen.getByLabelText("Add item to To Eat") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());

    fireEvent.change(input, { target: { value: "tacos" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("tacos")).toBeTruthy());
  });

  it("opens the general composer, creates a new category with its first item, and closes", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "To Go" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("To Go")).toBeTruthy());
    expect(screen.getByText("climb Fuji")).toBeTruthy();
    expect(screen.queryByLabelText("Item title")).toBeNull(); // composer closed
  });

  it("rejects an empty title or category without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/title is required/i)).toBeTruthy();
    expect(screen.getByLabelText("Item title")).toBeTruthy(); // composer still open

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/category is required/i)).toBeTruthy();
  });

  it("Escape closes the composer without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });

    fireEvent.keyDown(screen.getByLabelText("Item title"), { key: "Escape" });
    expect(screen.queryByLabelText("Item title")).toBeNull();
    expect(screen.queryByText("climb Fuji")).toBeNull();
  });

  it("reuses an existing category's casing when the general composer's category is a case-insensitive match", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "ramen" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "to eat" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());
    expect(screen.getAllByText("To Eat")).toHaveLength(1); // one section, not two
    expect(screen.queryByText("to eat")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/bucket-list-view.test.tsx`
Expected: FAIL — cannot find module `./bucket-list-view` (doesn't exist yet).

- [ ] **Step 3: Write `BucketListView`**

Create `frontend/src/features/tasks/components/views/bucket-list-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { groupBucketTasks } from "../../lib/categories";
import { useTasks } from "../../store";
import { BucketCategorySection } from "../bucket-category-section";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import type { CalendarViewProps } from "./weekly-view";

// anchor/onAnchorChange/onDrillDown are part of CalendarViewProps (every
// view in VIEW_COMPONENTS shares that shape) but a bucket list has no
// anchor date to page through, so this view simply doesn't use them.
export function BucketListView(_props: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const groups = groupBucketTasks(tasks);
  const categories = groups.map((g) => g.category);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerCategory, setComposerCategory] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);

  const closeComposer = () => {
    setComposerOpen(false);
    setComposerTitle("");
    setComposerCategory("");
    setComposerError(null);
  };

  const submitComposer = () => {
    const title = composerTitle.trim();
    const category = composerCategory.trim();
    if (!title) {
      setComposerError("Title is required.");
      return;
    }
    if (!category) {
      setComposerError("Category is required.");
      return;
    }
    actions.addBucketItem(title, category);
    closeComposer();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 overflow-y-auto transition-[padding-right] duration-200 ease-out",
        selectedTask && "pr-[420px]",
      )}
    >
      <p className="text-sm text-subtle">Things to do, eat, visit, or remember — no schedule needed.</p>

      {groups.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Your bucket list is empty</p>
          <p className="text-sm text-subtle">Add something you want to do, try, visit, or remember.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <BucketCategorySection
              key={group.category}
              category={group.category}
              active={group.active}
              completed={group.completed}
              onToggle={(taskId) => actions.toggleTask(taskId)}
              onSelect={(taskId) => setSelectedTaskId(taskId)}
              onDelete={(taskId) => actions.removeTask(taskId)}
              onAddItem={(title) => actions.addBucketItem(title, group.category)}
            />
          ))}
        </div>
      )}

      {composerOpen ? (
        <form
          className="space-y-2 rounded-md border border-input p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitComposer();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeComposer();
            }
          }}
        >
          <input
            value={composerTitle}
            onChange={(e) => setComposerTitle(e.target.value)}
            placeholder="Item title"
            aria-label="Item title"
            autoFocus
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <input
            value={composerCategory}
            onChange={(e) => setComposerCategory(e.target.value)}
            list="bucket-list-category-suggestions"
            placeholder="Category"
            aria-label="Category"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <datalist id="bucket-list-category-suggestions">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {composerError && <p className="text-xs text-destructive">{composerError}</p>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="group flex h-10 w-fit items-center gap-2.5 rounded-md px-1.5 text-foreground/70 outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus
            className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-visible:text-amber"
            aria-hidden
          />
          Add item
        </button>
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          bucketCategories={categories}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}
```

Note: `{...taskItemHandlers(selectedTask.id, actions)}` already supplies `onCategoryChange` (added to `taskItemHandlers` in Task 5, Step 13) — no need to pass it separately.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/views/bucket-list-view.test.tsx`
Expected: PASS — all eleven cases.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/components/views/bucket-list-view.tsx frontend/src/features/tasks/components/views/bucket-list-view.test.tsx
git commit -m "feat: add BucketListView"
```

---

### Task 8: Navigation — wire the Bucket List tab

**Files:**
- Modify: `frontend/src/features/tasks/components/view-switcher.tsx`
- Modify: `frontend/src/features/tasks/components/task-calendar.tsx`
- Modify: `frontend/src/features/tasks/components/task-calendar.test.tsx`

**Interfaces:**
- Consumes: `BucketListView` (Task 7).
- Produces: `"bucket"` is a reachable `ViewKind`, selectable from the tab bar. This is the final integration task — after this, the feature is reachable end-to-end from the running app.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/components/task-calendar.test.tsx`, inside the existing `describe("shiftAnchor", ...)` block:

```ts
  it("bucket has no anchor to page through — shiftAnchor is a no-op", () => {
    expect(shiftAnchor("bucket", "2026-07-16", 1)).toBe("2026-07-16");
    expect(shiftAnchor("bucket", "2026-07-16", -1)).toBe("2026-07-16");
  });
```

Add a new test in the `describe("TaskCalendar", ...)` block:

```ts
  it("switches to the Bucket List tab and shows its content", async () => {
    render(<TaskCalendar repository={fakeRepository()} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Bucket List" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Bucket List" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Bucket List", selected: true })).toBeTruthy(),
    );
    expect(screen.getByText("Your bucket list is empty")).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: FAIL — no tab named "Bucket List" exists yet; `shiftAnchor("bucket", ...)` is a TypeScript error since `"bucket"` isn't a valid `ViewKind` yet.

- [ ] **Step 3: Add `"bucket"` to `ViewKind`**

In `frontend/src/features/tasks/components/view-switcher.tsx`, change:

```ts
export const VIEWS = ["daily", "weekly", "monthly"] as const;
export type ViewKind = (typeof VIEWS)[number];

const VIEW_LABELS: Record<ViewKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};
```

to:

```ts
export const VIEWS = ["daily", "weekly", "monthly", "bucket"] as const;
export type ViewKind = (typeof VIEWS)[number];

const VIEW_LABELS: Record<ViewKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  bucket: "Bucket List",
};
```

- [ ] **Step 4: Wire routing in `task-calendar.tsx`**

In `frontend/src/features/tasks/components/task-calendar.tsx`, add the import:

```ts
import { BucketListView } from "./views/bucket-list-view";
```

Find `shiftAnchor`:

```ts
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
      return `${dir > 0 ? nextMonthKey(monthKeyOf(anchor)) : prevMonthKey(monthKeyOf(anchor))}-01`;
  }
}
```

Add a case:

```ts
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
      return `${dir > 0 ? nextMonthKey(monthKeyOf(anchor)) : prevMonthKey(monthKeyOf(anchor))}-01`;
    case "bucket":
      return anchor; // no anchor date to page through
  }
}
```

Find `VIEW_COMPONENTS`:

```ts
const VIEW_COMPONENTS = {
  daily: DailyView,
  weekly: WeeklyView,
  monthly: MonthlyView,
} as const;
```

Add the new view:

```ts
const VIEW_COMPONENTS = {
  daily: DailyView,
  weekly: WeeklyView,
  monthly: MonthlyView,
  bucket: BucketListView,
} as const;
```

Find `dateLabelFor`:

```ts
function dateLabelFor(view: ViewKind, anchor: string): string {
  switch (view) {
    case "daily":
      return dayLabel(anchor);
    case "weekly":
      return weekRangeLabel(weekStartOf(anchor));
    case "monthly":
      return monthLabel(monthKeyOf(anchor));
  }
}
```

Add a case. This is the page's shared title area for every view — bucket list has no date-based title, so it uses its own name, the same way the tab itself is labeled (`BucketListView` doesn't render a second, redundant "Bucket List" heading of its own — see Task 7):

```ts
function dateLabelFor(view: ViewKind, anchor: string): string {
  switch (view) {
    case "daily":
      return dayLabel(anchor);
    case "weekly":
      return weekRangeLabel(weekStartOf(anchor));
    case "monthly":
      return monthLabel(monthKeyOf(anchor));
    case "bucket":
      return "Bucket List";
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: PASS — all cases, including the two new ones.

- [ ] **Step 6: Run the full frontend suite, typecheck, and lint**

Run: `cd frontend && npx vitest run`
Expected: PASS, full suite (every test from Tasks 1–8).

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

Run: `cd frontend && npx eslint src/features/tasks`
Expected: 0 errors (pre-existing warnings in unrelated files are fine, matching the project's existing baseline).

- [ ] **Step 7: Run the backend suite once more**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test -v 2`
Expected: PASS, full suite (confirms Task 1's migration and model change still hold alongside everything else).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/components/view-switcher.tsx frontend/src/features/tasks/components/task-calendar.tsx frontend/src/features/tasks/components/task-calendar.test.tsx
git commit -m "feat: wire the Bucket List tab into navigation"
```

---

## Manual verification (not part of any task above)

After Task 8, open the real running app and click through:

1. Bucket List tab reachable from the tab bar.
2. Empty state, then use the general "+ Add item" composer to create a first category and item.
3. Add several items to that category with Enter from its own per-category row.
4. Complete/un-complete an item; confirm it moves below active items, muted and struck through.
5. Click a title to open the drawer; confirm Start/Duration/Repeat are absent and Category/Due date/Priority/Subtasks/Notes all work; change the Category field and click Done; confirm the item moved to the new section.
6. Resize to ~390px: confirm no horizontal overflow, category headers stay on one line, the composer's fields stack if needed.

Use Playwright (same approach as the drawer-polish pass this session) if a quick visual check from description alone isn't conclusive — real screenshots at ~1280px and ~390px, plus a hover/focus-state check on a row's delete control.
