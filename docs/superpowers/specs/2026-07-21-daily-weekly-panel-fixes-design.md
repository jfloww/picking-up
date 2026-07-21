# Daily Tab Weekly-Column Panel Fixes Design

**Date:** 2026-07-21
**Status:** Approved
**Builds on:** `2026-07-21-daily-task-detail-panel-design.md` (merged to `main`).

## Problem

Three issues found after using the shipped task detail panel (Daily tab):

1. The detail panel renders below the Weekly list; the user wants it above.
2. A Daily-tab task that's undone also rolls up into the Weekly list (an
   existing, unrelated `weeklyRollupTasks` feature) — so its title can
   appear in the Daily-tab row, the Weekly-list row, *and* the panel header
   at once, reading as duplication.
3. The panel's time field sits on its own row below the header; the user
   wants checkbox, task name, and time on the same line.

## Goal

Panel renders above the Weekly list. The anchor day's own day-scoped
tasks never appear in the Weekly list on the Daily tab (unconditionally,
not tied to selection) — they're already visible in the Daily column, so
showing them again in the Weekly list is always redundant there. The
panel's header row holds checkbox, title, and an editable time field
together.

## Changes

### 1. Panel above the list

`frontend/src/features/tasks/components/views/daily-view.tsx`: the
Weekly column's `ShrinkStack` call gains `secondaryFirst`, using the prop
already built for the rail/All-day reorder. No other prop changes —
`primary` (weekly list) keeps its 200px floor, `secondary` (the panel)
keeps its `calc()`-capped, self-scrolling growth; only which one renders
first (and therefore displays on top) changes.

### 2. No duplication: `ScopeTasks` gains `excludeDate`

`frontend/src/features/tasks/components/scope-tasks.tsx`: new optional
prop `excludeDate?: string`. Applied right after `items` is computed
(before the `compact`/full-row branch, so it's consistent either way):

```tsx
if (excludeDate) {
  items = items.filter(
    (i) => !(i.task.scope.kind === "day" && i.task.scope.date === excludeDate),
  );
}
```

Filtering on the *task's own scope* (not the rollup's display `date`
field) means a week-scoped task that merely displays a
rolled-over-from-today label is left alone — it isn't shown anywhere in
the Daily column, so hiding it from the Weekly list would make it
disappear from view entirely, which isn't the goal. Only actual
day-scoped tasks dated the excluded day are filtered.

`daily-view.tsx` passes `excludeDate={anchor}` on its `<ScopeTasks
scope={{ kind: "week", weekStart }} quickAdd />` call. This is
unconditional — it doesn't depend on `selectedTaskId` — so the anchor
day's tasks never show in the Weekly list on the Daily tab, matching the
"the task on 7/21 doesn't show in the Weekly body" example.

Nothing else changes: `ScopeTasks` is also used for non-`week` scopes and
by the standalone Weekly tab view (a different top-level view from the
Daily tab's side column) — `excludeDate` is optional and only passed by
`DailyView`, so those are unaffected.

### 3. Same-line panel header

`frontend/src/features/tasks/components/task-time-editor.tsx` (new): the
time `<input type="time">` + conditional "Clear" button, extracted
verbatim out of `TaskDetailFields`. Props: `time`, `onTimeChange`.

`frontend/src/features/tasks/components/task-detail-fields.tsx`: uses
`TaskTimeEditor` internally in its existing spot (same position/behavior
for the Weekly-list inline expansion — no visible change there), and
gains an optional prop `showTime?: boolean` (default `true`) that skips
rendering it when `false`.

`frontend/src/features/tasks/components/task-detail-panel.tsx`: header
row becomes checkbox + title + `TaskTimeEditor` + close button, all
inline (`flex items-center gap-2`, matching the row's existing style).
Passes `showTime={false}` to `TaskDetailFields` below so time isn't
rendered twice.

## Data & store

No changes.

## Testing

- `primitives.test.tsx` (existing `describe("ScopeTasks weekly rollup", ...)` block,
  where `ScopeTasks`/`weeklyRollupTasks` behavior is already tested): add
  a test that `excludeDate` filters out a day-scoped task dated that day,
  while a week-scoped task rolled over from that same date is still
  shown.
- `daily-view.test.tsx`: update the existing detail-panel tests — with
  the anchor day's tasks now excluded from the Weekly list, the title
  count once a panel is open drops back to 2 (Daily-tab row + panel
  header) from the previous 3, and 1 after swapping away. Add a test
  confirming the panel visually precedes the weekly list in document
  order (`compareDocumentPosition`), matching the `secondaryFirst`
  change.
- `task-time-editor.test.tsx` (new): renders the time input, calls
  `onTimeChange` on change and on Clear.
- `task-detail-fields.test.tsx` or existing `TaskItem`/`ScopeTasks`
  tests that exercise inline expansion: confirm `showTime` defaults to
  showing the time row (no change for existing callers).
- `task-detail-panel.test.tsx`: update to assert checkbox, title, and a
  time input are all present in the header, and `Clear` isn't
  double-rendered.
- Manual browser verification: panel appears above the weekly list;
  today's own tasks never show in the weekly list on the Daily tab, with
  or without a panel open; panel header shows checkbox/title/time on one
  line with no duplicate time field below.

## Out of scope (this iteration)

- Changing `weeklyRollupTasks` itself or its behavior in the standalone
  Weekly tab view — only the Daily tab's Weekly column gets the
  exclusion.
- Any change to the rail's shrink behavior or the panel's open/close/swap
  logic — all unchanged.
