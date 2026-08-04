# Bucket Categories as a First-Class Entity — Design Spec

**Date:** 2026-07-31
**Status:** Approved, ready for implementation planning

## Context

This is sub-project 1 of a 2-part effort. The full effort (motivated by a
reference design photo) is a sidebar-navigation shell plus a redesigned,
card-grid Bucket List page. That page redesign (sub-project 2) depends on
categories being real, persistent, renameable things — which they are not
today. This spec covers only sub-project 1: turning bucket categories from
an implicit, derived-from-tasks concept into a first-class backend entity.
Sub-project 2 (sidebar + page redesign) will be brainstormed and spec'd
separately once this ships.

### What changes from the current (shipped) design

The Bucket List feature shipped in PR #39 deliberately modeled categories
as **not** a separate entity: a category was just a free-text string copied
onto each bucket-scoped task's `scope_value`, categories appeared only when
a task used them, and disappeared the moment their last task left (deleted
or recategorized). This was an explicit, considered decision at the time
("just a text field on each item," "creating an item creates the
category").

That decision is now reversed. Categories need to:
- Persist independently of whether any task currently uses them.
- Survive going empty (an emptied category stays visible/usable).
- Be renamed as a single, atomic operation that updates every item that
  belongs to it.
- Be creatable explicitly, with zero items, via a dedicated action — not
  only implicitly by typing a new name onto an item.

## Data Model

**New `Category` model** (`backend/apps/tasks/models.py` or a new
`apps/tasks/models/category.py` if the file structure calls for a split —
decide during planning):

- `id` — primary key.
- `owner` — FK to the user, `on_delete=CASCADE` (matches `Task.owner`'s
  existing pattern).
- `name` — the category's display string. Unique **per owner**,
  case-insensitively (two categories differing only in casing are not
  allowed for the same user — matches today's case-insensitive-reuse rule,
  now enforced at the database/model level rather than derived at read
  time).
- `created_at` — set on creation, immutable. Drives category ordering (see
  below); unrelated to any task's `createdAt`.

**`Task` model change:** add a new nullable field, `bucket_category`
(FK to `Category`, `on_delete=models.SET_NULL`, `null=True`). There's no
delete endpoint in this pass, so this path shouldn't trigger in practice,
but `SET_NULL` is the semantically correct choice if a category row is
ever removed by other means (e.g. an admin action): the task survives,
uncategorized, rather than being destroyed. Used only when
`scope_kind == "bucket"`. The
existing `scope_value` CharField stops being used for bucket-scoped tasks
going forward — other scope kinds (`day`/`week`/`month`/`year`) are
untouched and keep using `scope_value` exactly as today.

Whether `scope_value` becomes fully unused for `"bucket"` rows or is kept
in sync as a denormalized display cache is a planning-time decision, not a
design-time one — the FK is the source of truth either way.

## API

Three new endpoints (exact routing/serializer shape to be decided during
planning, following this app's existing DRF patterns):

- **List** — the current user's categories, ordered by `created_at`
  ascending (oldest first).
- **Create** — takes a `name`. Server-side enforces trim + case-insensitive
  uniqueness per owner: creating "to eat" when "To Eat" already exists for
  that user does not create a duplicate — it should behave the same way
  the current free-text normalization does today (reuse the existing
  category, keeping its existing display casing), returning that existing
  category rather than erroring, so the frontend doesn't need special-case
  handling for "category already exists."
- **Rename** — updates `name` on an existing category (still subject to
  the same trim + case-insensitive-uniqueness-per-owner rule against the
  user's *other* categories). Because tasks hold a real FK, this is a
  single-row update — no bulk task rewrite needed, unlike the old
  free-text model.

No delete endpoint in this pass (explicit non-goal, see below).

## Migration

A data migration, run once per existing user with bucket-scoped tasks:

1. Collect that user's bucket-scoped tasks' `scope_value` strings.
2. Case-insensitively dedupe them into one `Category` row per distinct
   name — when duplicates differ only in casing, keep the casing used by
   whichever task has the earliest `createdAt` (matches the existing
   casing-resolution rule from `resolveCategoryCasing`).
3. Create those `Category` rows, `created_at` backfilled to something
   reasonable (e.g., the earliest member task's `createdAt`, so migrated
   categories sort in roughly the same relative order they did under the
   old derived-ordering rule).
4. Repoint every bucket-scoped task's new `bucket_category` FK to the
   correct `Category` row.

This is schema + data migration together; plan for it as its own reviewable
step, separate from the schema-only `AlterField`/`AddField` migration.

## Frontend

- `Scope`'s bucket variant changes shape. Exact form (a `categoryId`
  referencing the store's category list, vs. keeping a resolved `category:
  string` display name joined at read time, vs. both) is a planning-time
  API/type-design decision — this spec establishes only that the
  underlying identity becomes an ID, not a free-text string used for
  equality.
- Store gains a `categories` slice: fetch on load (alongside the existing
  task fetch), plus `createCategory(name)` and `renameCategory(id, name)`
  actions following the same `repo`-backed dispatch pattern every existing
  store action uses.
- `TaskCategoryEditor` (currently a free-text input with a datalist of
  in-use categories) changes to a **select from the fetched category
  list** — no more typing an arbitrary new name into this field to create
  a category on the fly. The item composer's category field changes the
  same way.
- A new, separate "+ New Category" action (exact placement is sub-project
  2's concern, since it lives on the redesigned page) is the only way to
  create a category with zero items.
- `lib/categories.ts`'s `groupBucketTasks`/`resolveCategoryCasing`/
  `bucketCategoriesInUse` helpers get revisited during planning: grouping
  by a real category list (including empty ones) is a different shape of
  problem than deriving groups purely from tasks-in-use.

## Non-Goals (this pass)

- **No delete.** A category, once created, cannot be removed. An unwanted
  empty category just sits there unused. Deletion (and the reassignment/
  cascade UX it would need) is left for a future pass.
- **No manual reordering.** Category order is `created_at` ascending,
  full stop — no drag-and-drop, no position field.
- **No images, no 4-state status (Pending/In Progress/Completed/Someday),
  no progress percentage.** These were considered (from the reference
  photo that motivated this whole effort) and explicitly declined —
  bucket items stay on the existing done/not-done model. Out of scope for
  both sub-projects, not just this one.
- **Sidebar navigation, the card-grid page redesign, search, stat cards,
  category tabs as UI** — all sub-project 2, not this spec.

## Testing Considerations

- Backend: model-level uniqueness (case-insensitive, per-owner) tests;
  create-returns-existing-on-duplicate-name behavior; rename updates every
  referencing task's effective category with a single write; the
  migration itself needs a test exercising a user with duplicate-casing
  categories across multiple tasks, confirming correct dedupe and FK
  repointing.
- Frontend: store's `createCategory`/`renameCategory` actions (mirroring
  the existing `addBucketItem`/`setCategory` test patterns); the category
  select components now source from fetched categories rather than
  deriving from tasks-in-use, so tests need a seeded category list
  independent of task data (including the empty-category case, which
  could never be tested before this change since it couldn't exist).
