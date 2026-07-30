# Bucket List

**Date:** 2026-07-30
**Status:** Approved

## Problem

Picking-up has no place for unscheduled, someday-ideas — things you want to do/eat/visit/read but that don't belong on a specific day, week, month, or year. Today the only way to capture one is to force it into a scope it doesn't really have (e.g. dumping it on "this week").

## Goal

A new "Bucket List" view: tasks grouped by a free-text category (`To Go`, `To Eat`, `To Do`, ...), with no schedule. Reuses the existing `Task` model, store, sync path, and `TaskDetailDrawer` almost entirely — this is a new *scope kind* and a new *view*, not a new subsystem.

## Non-goals (explicit v1 cut)

A `Category` database table, empty persistent categories, manual category/item ordering or drag-and-drop, category colors/icons, category collapse, a dedicated bulk-rename or delete-category action, sharing, templates, image attachments, a separate Bucket Item API. Any of these can follow later if the simple version turns out to need them.

## Data model

### `types.ts`

Add one `Scope` variant:

```ts
export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string }
  | { kind: "bucket"; category: string };
```

Extend the exhaustive `scopeKey` switch:

```ts
case "bucket":
  return `bucket:${scope.category}`;
```

No other field changes — a bucket item is a normal `Task` row (`done`, `subtasks`, `priority`, `dueDate`, `memo`, `createdAt` all already exist and already work).

### `api/mapping.ts`

Both exhaustive switches get a case, following the existing pattern exactly:

```ts
// scopeValueOf
case "bucket":
  return scope.category;
```

```ts
// scopeFromParts
case "bucket":
  return { kind: "bucket", category: value };
```

### Backend (`apps/tasks/models.py`)

```python
SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("bucket", "bucket"),
]
```

`scope_value` is currently `models.CharField(max_length=20)` — sized for `"YYYY-MM-DD"`/`"YYYY-MM"`/`"YYYY"`, too small for a free-text category (`"Restaurants to try before I leave"` is 34 chars). Widen it:

```python
scope_value = models.CharField(max_length=60)
```

Confirmed by running `makemigrations --dry-run`: this produces **one migration file with three `AlterField` operations** — `scope_kind` and `rolled_from_kind` (both metadata-only, they share the same `choices=SCOPE_KIND_CHOICES` list, so both get touched when it changes — no real schema effect), and `scope_value` (a real `ALTER COLUMN` to widen it — needs verifying against Oracle too, not just SQLite). `TaskSerializer` needs no changes — `scope_kind`/`scope_value` aren't declared explicitly there, so DRF's `ModelSerializer` regenerates their validation from the model automatically (confirmed: no other file references `scope_kind`/`scope_value` validation logic).

### No-leakage verification

Checked already, not just assumed: every existing scope filter (`lib/times.ts`'s `weekStats`/`monthStats`/`dayTasksForWeek`, `scope-tasks.tsx`) uses exact positive matching (`scope.kind === "day"`, `=== "week"`, `=== "month"`) — never a catch-all or negation. A new `"bucket"` kind is excluded by construction. Still gets an explicit regression test (see Testing).

## Category rules

New file `lib/categories.ts`:

```ts
export function normalizeCategoryInput(input: string): string {
  return input.trim();
}

// Case-insensitive match against categories already in use; returns the
// EXISTING display casing on a match, or the trimmed input if it's new.
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
  const groups = Array.from(byCategory.entries()).map(([category, items]) => {
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      category,
      active: sorted.filter((t) => !t.done),
      completed: sorted.filter((t) => t.done),
      earliestCreatedAt: sorted[0].createdAt,
    };
  });
  groups.sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));
  return groups.map(({ category, active, completed }) => ({ category, active, completed }));
}

export function bucketCategoriesInUse(tasks: Task[]): string[] {
  return groupBucketTasks(tasks).map((g) => g.category);
}
```

An empty category can't exist (nothing to represent it with) — when a category's last task is deleted or its category is changed via the drawer, `groupBucketTasks` simply stops producing an entry for it on the next render. No cleanup action needed.

## Store (`store.tsx`)

One new action, following the exact shape of `addTask`/`setDueDate`:

```ts
addBucketItem(title: string, category: string): Task | undefined {
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
  dispatch({ type: "created", task });
  repo.create(task).catch(handleSyncFailure);
  return task;
},
```

`setCategory(id, category)` mirrors `setDueDate` exactly (read current task, replace `scope`, dispatch, `repo.update`) — used by the drawer's new Category field. Both go through `TasksContextValue` the same way every other action does. **No new store, no new repository, no second sync path** — same `repo.create`/`repo.update` used by every existing action.

## Navigation (`view-switcher.tsx`)

```ts
export const VIEWS = ["daily", "weekly", "monthly", "bucket"] as const;
```

`VIEW_LABELS.bucket = "Bucket List"`. Same tab styling/behavior as the other three — no navigation redesign. If the four-tab row doesn't fit at ~390px, this is the same problem three tabs already had to solve; reuse whatever that solution already is rather than inventing a new one (checked: currently the tab row doesn't wrap or scroll specially, it just shrinks — worth a quick look during implementation at whether four tabs still fits before assuming it needs a new responsive treatment).

`task-calendar.tsx`: `shiftAnchor`/`dateLabelFor`/`VIEW_COMPONENTS` gain a `"bucket"` case. Since a bucket list has no "anchor date" to page through, `shiftAnchor("bucket", ...)` returns the anchor unchanged, and the view-switcher's prev/next/today controls are simply not meaningful here — the new view ignores `anchor` entirely (same shape as the other views' props, just doesn't use the date).

## New view: `components/views/bucket-list-view.tsx`

Reads `tasks` from `useTasks()`, computes `groupBucketTasks(tasks)`. Renders:

- A `Bucket List` heading + one quiet helper line, same page container/padding/header alignment as the other views (no new page shell).
- One `BucketCategorySection` per group (stacked, `space-y-*` + one subtle divider between sections — no cards).
- A general add-item row after the last section (see below).
- Empty state when there are no bucket tasks at all: `Your bucket list is empty` / `Add something you want to do, try, visit, or remember.` — plain text in the normal content area, no illustration, pointing at the general add row.

### `BucketCategorySection`

Header row: category name (left, same `text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase` treatment already used for "SUBTASKS"/"NOTES"), item count (right, `"N items"`). Below it: active items, then completed items, then a per-category `+ Add item` row.

### `BucketItemRow`

This is `subtask-list.tsx`'s `DrawerSubtaskRow` pattern lifted up a level, not reinvented: ~40px cardless row, accessible checkbox, click-to-edit title (inline `<input>`, Enter commits/Escape cancels, matching `DrawerSubtaskRow`'s existing `startEditing`/`commit`/`cancel` shape), hover/focus-revealed delete (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`), completed rows muted + `line-through`. New, since bucket items aren't subtasks: quiet metadata after the title when present — due-date badge (reuse `dueDateLabel`/`isOverdue` from `lib/dates.ts`, same treatment as `TaskItem`'s existing due-date badge) and a priority indicator (reuse the existing `Star` glyph treatment) — both optional, absent when unset, never the only signal for anything (completion is checkbox + strikethrough, not color alone). Clicking the title opens `TaskDetailDrawer` for that task, same wiring as every other view (`taskItemHandlers`).

### Per-category add row

Visually identical to `subtask-list.tsx`'s existing add-subtask row (quiet at rest, `text-amber` on the icon on hover/focus only, Enter submits and clears leaving the input focused for the next entry, Escape... there's nothing to cancel back to since it's not an expand/collapse control, just a plain input). Calls `addBucketItem(title, category)` with `category` fixed to that section's own category — no picker needed here.

### General add row

Below the last section (or the empty state). At rest: a single quiet `+ Add item` control, same restrained styling as the per-category rows (amber only on hover/focus, never filled — the one filled-amber CTA on the app stays reserved for the global Add Task control, untouched here per the earlier drawer-redesign decision). On activation: an inline composer (not a modal — matches how Notes/per-category-add already expand inline) with a title input and a category input using a native `<datalist>` for suggestions (same technique `TaskTimeEditor` already uses for duration presets — type-to-filter, or type a name not in the list to create it). Both inputs sit in one `<form>`, same as `QuickAdd` — no visible submit button, matching every existing add-row in this app (`QuickAdd`, the per-category row above). Enter from either field submits the form; if both are valid it creates the item and closes the composer, if either is empty/whitespace-only the submit is rejected and an inline message says which field needs a value — never silently dropped. Escape closes the composer without creating anything.

## `TaskDetailDrawer` / `TaskDetailFields`

- `TaskDetailDrawer` passes `showTime={task.scope.kind !== "bucket"}` to `TaskDetailFields` (currently no `showTime` prop is passed at all, defaulting to `true`). This hides Start/Duration. Repeat is **already** hidden for a bucket task with zero code changes — `showRepeat` requires `scope.kind === "day"` or `repeatWeekdays` set, both false for a bucket item.
- Due date, Priority, Background, Subtasks, Notes: untouched, already work for any non-routine task and a bucket task is never routine.
- New: a `Category` field, rendered only when `task.scope.kind === "bucket"`, placed in `schedulingCluster` between the Due-date section and the Priority/Background row (matches "near Due date and Priority"). New small component `TaskCategoryEditor`, structurally identical to `TaskDueDateEditor` (label + input, `variant="drawer"` styling) but using the same `<input list="...">` + `<datalist>` combobox technique as `TaskTimeEditor`'s duration presets, so existing categories are suggested but typing a new one is just as valid.
- `TaskDetailFields` gains an optional `bucketCategories?: string[]` prop (default `[]`) and `onCategoryChange?: (category: string) => void`, threaded through from `TaskDetailDrawer`. Daily/Weekly/Monthly's existing `TaskDetailDrawer` call sites don't need to change — they never render a bucket-scoped task, so the field never appears and the missing prop is inconsequential. Only `bucket-list-view.tsx`'s call site passes real values (`bucketCategoriesInUse(tasks)` and a handler calling the new `setCategory` store action).
- Everything else approved in the drawer-polish pass (spacing, footer hierarchy, Notes/Subtasks behavior, colors) is unchanged — this touches exactly one new conditional field and one existing prop's default value.

## Responsive / accessibility

Follows patterns already established this session, not new ones: same page container and horizontal padding as other views at desktop width; at ~390px, category headers stay on one line, due-date/priority metadata is the first thing to hide if a title would otherwise get crushed (title always wins), checkbox/action targets stay accessible-sized, the general composer's fields stack if needed, no horizontal overflow. Delete/other hover-only actions are also keyboard-focus-revealed (already true of the `DrawerSubtaskRow` pattern being reused). Focus rings: thin blue, no glow (existing `focus-visible:ring-2 focus-visible:ring-ring/50` pattern, not a new one). The drawer's own mobile/sheet behavior is untouched.

## Testing

- `lib/categories.test.ts` (new): `normalizeCategoryInput` trims; `resolveCategoryCasing` returns existing casing on a case-insensitive match and the trimmed input otherwise; `groupBucketTasks` orders categories by earliest `createdAt`, splits active/completed within a group, preserves creation order within each split; a task with a non-bucket scope is excluded entirely.
- `types.test.ts` (new — `scopeKey` has no existing test file, confirmed): a `"bucket"` case, plus the four existing kinds for a baseline.
- `api/mapping.test.ts`: round-trip a bucket-scoped task through `toApiPayload`/`fromApiPayload` (mirrors the existing "round-trips a year-scoped task" test).
- Backend `apps/tasks/tests.py`: create/update/fetch a task with `scope_kind="bucket"`, `scope_value` holding a category longer than 20 chars (proves the widened column); `scope_kind` choice validation accepts `"bucket"`.
- `store.test.tsx`: `addBucketItem` trims title, normalizes category casing against existing categories, rejects an empty title or category; `setCategory` moves a task between categories (reflected in `groupBucketTasks` on the next read).
- `view-switcher`/`task-calendar.test.tsx`: Bucket List tab present and switchable; `shiftAnchor("bucket", ...)` is a no-op.
- `bucket-list-view.test.tsx` (new): category grouping and order; active-before-completed with stable ordering; item counts; empty state; adding several items via Enter in one category without losing focus; creating a new category via the general composer; case-insensitive category match reuses existing casing; rejecting empty title/category; Escape closes the composer without creating anything; completing/uncompleting an item; deleting an item; a category that loses its last item stops rendering on the next update.
- `task-detail-drawer.test.tsx`: for a bucket-scoped task, Start/Duration/Repeat are absent, Due date/Priority/Background/Subtasks/Notes still work, the Category field is present and calls `onCategoryChange`; for a day/week/month/year-scoped task, the Category field is absent.
- Regression: a filter test per existing view (`weekStats`/`monthStats`/`dayTasksForWeek`/`scope-tasks`) confirming a bucket-scoped task is excluded.

## Verification

Real dev server, not just unit tests — same Playwright-measurement approach used for the drawer-polish pass: populated desktop view (~1280px) compared against the design; empty state; row hover/focus states; the general composer open and closed; the drawer for a bucket item; mobile (~390px) with no horizontal overflow; row-height/alignment consistency measured, not eyeballed.
