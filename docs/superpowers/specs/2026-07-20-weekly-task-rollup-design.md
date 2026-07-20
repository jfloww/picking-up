# Weekly Task Rollup Design

**Date:** 2026-07-20
**Status:** Approved
**Builds on:** `2026-07-20-daily-tab-redesign-design.md` (merged, live at `/app` Daily view).

## Problem

The "Weekly Task" list (the Daily tab's week column, and the Weekly view's own
per-week cell) only shows tasks created directly at the week level
(`scope.kind === "week"`, no date). Day-scoped tasks — the vast majority of
tasks in the app — never appear there, even when unfinished, with one
partial exception: `rolloverTasks` (`lib/rollover.ts`) already converts an
unfinished day task into a week-scoped task once its date is in the past,
so it does show up today, but only as a bare title with a rollover icon —
its original date is discarded from the display (though preserved in
`rolledFrom`). Today's and future days' unfinished tasks in the current
week are entirely invisible from the weekly list.

## Goal

Make the Weekly Task list a useful single place to see everything
unfinished for the week: existing week-level tasks, plus every unfinished
day-scoped task whose date falls in that week (past-rolled, today, or
upcoming), each labeled with its date and time (if it has one). Applies
uniformly wherever a week's task list renders — the Daily tab's Weekly Task
column and the Weekly view's own "Weekly" cell both use the same underlying
query, so they never disagree about what "this week" contains.

## Data model & inclusion rules

No schema changes. For a given `weekStart`, the list includes:

- Existing week-level tasks (`scope.kind === "week"`, `scope.weekStart === weekStart`)
  — done and undone, exactly as today. Quick-add into this list still creates
  a plain week-scoped task, unchanged.
- **New:** unfinished day-scoped tasks (`scope.kind === "day"`, `!done`) whose
  date falls within that week (`weekStartOf(date) === weekStart`).

Each item gets an associated date, used for display and sort:

| Task shape | Date used |
|---|---|
| Day-scoped (`scope.kind === "day"`) | `scope.date` |
| Week-scoped, rolled over from a day (`rolledFrom.kind === "day"`) | `rolledFrom.date` |
| Week-scoped, never tied to a day (no `rolledFrom`, or `rolledFrom.kind === "week"`) | none |

**Sort order:** chronological by date, then by time within a date (untimed
after timed, matching the existing day-sort rule `compareTasksForDay`);
dateless week-level tasks sort last, in their existing relative order.

## Display format

- **Full (non-compact) rendering** — used by the Daily tab's Weekly Task
  column and the Weekly view's focused week cell: each row shows a date
  label before the existing time badge, e.g. `Mon Jul 20 · 09:00  Standup`.
  A task due today shows `Today` instead of the literal date. Dateless
  week-level tasks show no label (unchanged from today).
- **Compact rendering** — used by the Weekly view's non-focused per-day and
  per-week cells (small "peek" cells, already terse: truncated title + time
  only): the expanded task set (including day-scoped tasks) shows up here
  too, but **without** a date-label prefix. These cells are too small for a
  `Mon Jul 20 ·` prefix, and their existing terseness is intentional — only
  the full rendering gets date labels.

## Architecture

- **`lib/dates.ts`**: new `shortDateLabel(dateKey: string, today: string): string`
  — returns `"Today"` when `dateKey === today`, otherwise a short form like
  `"Mon Jul 20"` (weekday + month + day, no year — matches the app's other
  short-form date displays).
- **`lib/times.ts`**: new `weeklyRollupTasks(tasks: Task[], weekStart: string): { task: Task; date: string | null }[]`
  — pure function implementing the inclusion rules above, pre-sorted per the
  sort order. Imports `weekStartOf` from `./dates`.
- **`components/scope-tasks.tsx`**: the `scope.kind === "week"` branch calls
  `weeklyRollupTasks` instead of the current plain scope-key filter. In the
  non-compact branch, maps each item's `date` through `shortDateLabel` (using
  `todayKey()`) and passes it to `TaskItem` as `dateLabel`. The compact
  branch uses the same data but does not pass a date label. The `scope.kind
  === "day"` branch (both compact and non-compact) is unchanged.
- **`components/task-item.tsx`**: add an optional `dateLabel?: string` prop,
  rendered immediately before the existing `task.time` badge, same visual
  treatment (small, subtle, tabular where relevant).

## Error handling

N/A — this is a read-side query and display change. `rolloverTasks` (which
already handles the "date has passed" transition) is unchanged; this feature
only changes what's queried and displayed, not the task/store data model or
mutation logic.

## Testing

- `lib/times.test.ts`: `weeklyRollupTasks` — a done day task is excluded; an
  unfinished day task in the target week is included with its date; a task
  from a different week is excluded; a rolled-over week task surfaces
  `rolledFrom.date`; a genuine week-level task has `date: null` and sorts
  last; same-date tasks sort by time, untimed after timed.
- `lib/dates.test.ts`: `shortDateLabel` — returns `"Today"` when the date
  matches `today`; returns the short weekday/month/day form otherwise.
- `components/scope-tasks.test.tsx`: a future day's unfinished task appears
  in a week-scope render with its date label; a done day task does not
  appear; compact rendering includes the task but omits the date label.
- `components/task-item.test.tsx`: `dateLabel` prop renders when provided,
  is absent when not.
- `components/views/daily-view.test.tsx` / `weekly-view.test.tsx`: an
  end-to-end check that a future day's unfinished task shows up in both the
  Daily tab's Weekly Task column and the Weekly view's per-week cell for the
  same week.

## Out of scope (this iteration)

- Any change to `rolloverTasks` / `lib/rollover.ts` itself — the rollover
  transition (day → week scope once a date passes) is unchanged; this
  feature only changes how the result is queried and displayed.
- Editing a task's date from within the Weekly Task list (no drag-to-reschedule
  or date picker here) — items remain read/toggle/expand-editable exactly as
  `TaskItem` already supports (time, memo, subtasks, delete), just with a
  date label added.
- Grouping by date with section headers (e.g. a "Monday" divider) — a flat,
  sorted list is the v1; grouping can be a follow-up if the flat list feels
  cluttered in practice.
- Any change to the Daily tab's own per-day list or Monthly/Yearly views —
  scoped strictly to wherever a week-scope task list renders.
