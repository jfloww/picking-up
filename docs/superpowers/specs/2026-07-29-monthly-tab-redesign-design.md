# Monthly Tab Redesign

**Date:** 2026-07-29
**Status:** Approved

## Problem

The "Monthly" tab currently isn't a calendar at all — `MonthlyView` renders
`YearGrid` (the same component Yearly uses), just with one month focused
and a side panel of that month's tasks. It has no distinct job from
Yearly; both are "pick a period, see a rollup list." There is no view of
a month's actual days.

## Goal

Give Monthly a real calendar-month grid (5–6 weeks Ă— 7 days) with a
distinct purpose in this app's view hierarchy:

- **Daily** = execute (today's timeline)
- **Weekly** = balance and arrange (drag tasks between days)
- **Monthly** = scan commitments, deadlines, and workload patterns at a glance
- **Yearly** = long-range overview (unchanged, not in this scope)

This spec covers Monthly only. Yearly is explicitly out of scope for this
pass.

## Grid structure

- A new `MonthGrid` component replaces `YearGrid` as what `MonthlyView`
  renders (Yearly keeps using `YearGrid` as-is).
- Rendered as **one continuous grid**, not a collection of individually
  rounded/bordered day cards — a single outer container with internal
  divider lines between cells (Tailwind's `divide-x`/`divide-y` on the
  grid, not per-cell `border` + `rounded-md`), so it reads as one surface,
  matching a real calendar rather than a tray of tiles.
- Layout is `week-count Ă— 8` columns: 7 day cells + **1 narrow gutter
  column on the left** carrying a week-of-year label with an inline
  chevron (e.g. `W31 ›`), clicking it calls `onDrillDown?.("weekly", <a
  date in that row>)`. Text-plus-chevron, not an isolated icon, so its
  purpose is discoverable without a hover hint.
- Rows fill available height (`grid-rows-[repeat(N, minmax(6rem, 1fr))]`)
  but never shrink below **6rem (96px)** per row — enough for the date
  number, completion count, two title lines, and an overflow line at this
  app's dense (10–13px) label sizing. When 5–6 rows at that minimum exceed
  the viewport, the page scrolls rather than the grid compressing rows
  into illegibility — this view does not need to fit without scrolling
  the way Daily/Weekly's fixed-viewport panels do.
- Out-of-month leading/trailing days are shown as real dates (muted), not
  blank cells — the existing `monthGrid()` util in `lib/dates.ts`
  currently returns `null` for those slots (and is presently unused
  anywhere in the app); this spec extends it to return real adjacent-month
  date strings for every cell instead, since there's no other consumer to
  break by changing its contract.
- A new small util computes each row's week-of-year number for the gutter
  label (no existing util does this) — a simple sequential count of
  Sunday-starting weeks since January 1st of that date's year (consistent
  with this app's existing Sunday-start week convention, `weekStartOf`),
  not strict ISO 8601 week numbering (which starts weeks on Monday and has
  its own year-boundary rules this app doesn't otherwise follow).

## Above the grid: a monthly summary

A compact summary bar above the grid, styled consistently with Weekly's
existing "This Week" bar (`bg-muted/40`, done/total count, progress bar) —
"This Month," this month's done/total count, same progress-bar treatment.

## Day cell content

- Date number, top-left.
  - **Today**: a small brand-colored pill/badge around just the number
    (not the whole cell) — the familiar "today" treatment from most
    calendar UIs.
  - **Selected date** (the one whose day-agenda drawer is currently open,
    see below): the whole cell gets a subtle brand tint background plus a
    brand outline ring — visually distinct from today's pill, since a day
    can be selected without being today, and today isn't automatically
    selected.
  - **Out-of-month**: muted (`text-subtle`), same treatment applied to
    the rest of that cell's content.
- Completion count (e.g. `2/5`), small, tabular-nums.
- Up to **2 active (undone) task titles**, each prefixed with a small
  status dot/icon rather than a full tinted row background — this keeps
  the preview text-first at this density instead of importing Daily/
  Weekly's per-row background treatment, which doesn't fit in a ~7-line
  cell. Status dots reuse the app's existing semantic colors: default
  (muted/no dot needed), pending-today (warning), overdue (destructive),
  repeat/rolled-over (a shrunk version of the existing `RotateCw` icon).
- If there are more active tasks than fit, a trailing `+N more` line.
  Completed tasks never take a title line — they're represented only in
  the completion count, per the "text-first, done tasks summarized"
  requirement.
- The whole cell is one click target: **single click** selects that date
  (sets it as the "selected date" described above) and opens the
  day-agenda drawer. **Double-click** is a secondary shortcut straight to
  Daily (`onDrillDown?.("daily", date)`) — kept for parity with Weekly's
  existing double-click-to-Daily pattern, but not the primary or only way
  in, since double-click isn't discoverable and doesn't translate to touch.

## Day-agenda drawer (new component)

A new drawer type — distinct from the existing `TaskDetailDrawer`, which
edits one task's fields, not a day's task list.

- Desktop: slides in from the right, same shell conventions as
  `TaskDetailDrawer` (`fixed inset-y-0 right-0`, slide transition,
  `Escape`/X to close).
- Header includes the date and an explicit **"Open Daily"** button
  (calls `onDrillDown?.("daily", date)`) — a discoverable, primary
  navigation action. Double-clicking the cell remains a shortcut to the
  same destination, not a replacement for this button.
- Body: a full (non-compact) `ScopeTasks` for that date, with quick-add —
  i.e., this drawer *is* a day agenda, reusing the same list component
  Weekly's columns already use, just presented as an overlay instead of a
  persistent grid column.

## Navigation stack (day-agenda ↔ task-detail)

Clicking a task inside the day-agenda drawer opens the existing
`TaskDetailDrawer` for that task — but the two drawers are **one overlay
layer at a time**, treated as a navigation stack, not simultaneously
stacked panels:

- Selecting a day opens the day-agenda drawer (state: showing day X).
- Selecting a task inside it replaces that with the task-detail drawer
  (state: showing task Y, remembering it came from day X).
- Closing the task-detail drawer returns to the day-agenda drawer for day
  X (back-navigation), not straight to the closed/no-overlay state.
- Closing the day-agenda drawer (from either entry point) returns to the
  plain grid, no overlay.

`MonthlyView` models this as one piece of state describing which single
overlay is showing (a day, or a task reached from a day), rather than two
independent boolean/id states that could both be "open" at once.

## Mobile

Below the `sm` breakpoint (matching this app's existing responsive
convention):

- The 7-day grid becomes a **week-grouped vertical agenda** — days listed
  top to bottom, grouped under their week (carrying the same week-of-year
  label the desktop gutter shows), each day showing the same compact
  preview content (date, count, up to 2 active titles + "+N more").
- Tapping a day opens the day-agenda as a **full-screen sheet** instead of
  the narrow right-side drawer — a right-anchored 400px panel doesn't work
  on a narrow viewport. Same navigation-stack rule applies: opening a task
  from within it replaces the sheet with `TaskDetailDrawer` (which already
  goes full-width on narrow screens via its existing `max-w-full`), and
  closing that returns to the day sheet.
- No drag-to-reschedule on Monthly in this pass (matches the desktop
  decision — target cells are far smaller than Weekly's columns, and this
  spec doesn't introduce it there either).

## Non-goals

- Yearly view: unchanged, out of scope for this spec.
- Drag-to-reschedule within the Monthly grid.
- Within-cell task reordering.
- Any change to `TaskDetailDrawer`'s own fields/behavior — it's reused as-is.
- Any change to Daily or Weekly views themselves (only their existing
  `onDrillDown` entry points are used).

## Implementation approach (high level; exact code in the plan)

- `frontend/src/features/tasks/lib/dates.ts`: extend `monthGrid()` to
  return real adjacent-month date strings instead of `null` for
  out-of-month cells; add a week-of-year util for the gutter label. Update
  `monthGrid`'s existing test (currently the function's only consumer) to
  match the new contract.
- New `frontend/src/features/tasks/components/views/month-grid.tsx`: the
  grid component described above, replacing `YearGrid` as what
  `MonthlyView` renders. `YearGrid` itself is untouched (Yearly still uses it).
- New `frontend/src/features/tasks/components/day-agenda-drawer.tsx`: the
  day-agenda overlay described above, responsive between the desktop
  right-panel shell and the mobile full-screen sheet shell.
- `frontend/src/features/tasks/components/views/monthly-view.tsx`: updated
  to render `MonthGrid` instead of `YearGrid`, own the navigation-stack
  state (selected day / selected task-reached-from-day), and wire
  `onDrillDown` for both the week-gutter and the day-agenda's "Open Daily"
  button.
- Reuses without modification: `ScopeTasks`, `TaskDetailDrawer`,
  `TaskItem`'s existing semantic color tokens for status dots.

## Testing

- `dates.ts`: update `monthGrid()`'s test for the new real-dates contract;
  add a test for the new week-of-year util.
- `month-grid.tsx`: cell content (date, count, up to 2 titles + overflow,
  today pill, selected-date tint, out-of-month muting), single-click
  selects + opens the drawer, double-click drills to Daily, week-gutter
  click drills to Weekly.
- `day-agenda-drawer.tsx`: renders the date's full task list via
  `ScopeTasks`, "Open Daily" button fires the right callback, closes on
  Escape/X.
- `monthly-view.tsx`: the navigation-stack behavior specifically — opening
  a task from the day-agenda drawer shows only the task-detail drawer
  (not both), and closing the task-detail drawer returns to the day-agenda
  drawer rather than closing everything.
