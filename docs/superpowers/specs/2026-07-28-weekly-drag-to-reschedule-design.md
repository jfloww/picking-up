# Weekly Tab: Drag-to-Reschedule

**Date:** 2026-07-28
**Status:** Approved

## Problem

The Daily view already supports dragging a task onto a time slot
(`useDragToSchedule` in `frontend/src/features/tasks/components/use-drag-to-schedule.ts`).
The Weekly view (`weekly-view.tsx`) has no equivalent — moving a task to a
different day currently requires opening its detail drawer and editing the
date by hand. The request is to drag a task card from one day's column to
another within the Weekly grid, saving the new date as soon as the drag
completes.

## Goal

Let a user pick up a task shown in one of the Weekly tab's seven day
columns and drop it into a different day's column, updating that task's
scope date immediately on drop — no confirmation step, no separate save
action.

## Scope decisions (brainstormed and approved)

- **Move only, not reorder.** Dragging changes which day a task belongs to.
  There is no manual within-day ordering in this app's data model (day
  lists are sorted by time/creation, not a persisted order), so
  within-column reordering is out of scope.
- **Independent hook, not a refactor of Daily's drag code.** A new
  `useDragToRescheduleDay` hook is built alongside the existing
  `useDragToSchedule`, not by refactoring it. The two hooks' pointer-gesture
  mechanics (drag threshold, pointer capture/release, click-suppression) are
  substantially similar — a case could be made for a shared primitive — but
  their *resolution* logic is genuinely different (Daily resolves a y-pixel
  to a time-of-day; Weekly resolves a pointer position to "which of these 7
  day columns"). Touching the existing, working, tested Daily drag
  implementation as a side effect of a Weekly-only feature is not worth the
  regression risk it introduces for no immediate benefit to this feature.
  **This is flagged, explicitly, as a good candidate for a future
  DRY pass once both hooks are proven — not silently accepted duplication.**
- **Repeat-generated instances detach on drag**, using the same mechanism
  the existing "detach from routine" feature already provides
  (`detachFromRoutine` in `store.tsx`): the dragged instance's
  `repeatSourceId` is cleared, and the anchor task's `excludedDates` gains
  the instance's *original* date (so the routine's own recurring schedule
  is undisturbed and doesn't respawn a task on the day it was just dragged
  away from). This mirrors editing any other field on a repeat instance —
  dragging its day is just another one-off edit.
- **`time` is preserved across the move.** A task scheduled for 9:30 AM
  that gets dragged from Monday to Wednesday keeps its 9:30 AM time; only
  the date changes.
- **Applies to all day-scoped tasks in a column, done or not** — matching
  the existing Daily drag-to-schedule, which doesn't exclude completed
  tasks either.

## Interaction design

- **While dragging**, the day column currently under the pointer gets a
  visual highlight (ring/background tint), analogous to Daily's dashed
  preview line but at column granularity instead of a time position. The
  dragged card itself gets the existing drag-ghost treatment
  (`shadow-lg`, per `.superdesign/design-system.md`) applied in place —
  matching Daily's existing drag-to-schedule, the source card does **not**
  follow the pointer as a floating ghost; it stays where it is, and the
  column highlight alone communicates the destination. This keeps the
  interaction consistent with Daily and avoids adding floating-element
  positioning logic that doesn't exist anywhere else in this codebase.
- **On drop over a valid day column**, the task's `scope.date` updates
  immediately — optimistic UI update via the existing reducer/dispatch
  pattern, followed by the existing `repo.update(...).catch(handleSyncFailure)`
  persistence path every other store action already uses. No dialog, no
  extra confirmation.
- **Dropping on the same day** (no actual change) is a no-op: no dispatch,
  no save call.
- **Releasing outside any day column** (e.g., over the "This Week" summary
  bar, or off the grid entirely) cancels the drag: the task stays on its
  original day, nothing is dispatched or saved.
- **Sync failures** fall into the existing resync-and-error-banner path
  (`handleSyncFailure`) — no feature-specific error handling.

## Implementation approach

- **`frontend/src/features/tasks/components/use-drag-to-reschedule-day.ts`**
  (new): a pointer-gesture hook shaped like `useDragToSchedule` (threshold
  detection, `setPointerCapture`/`releasePointerCapture`, click-suppression
  guard against the browser's post-drag synthetic click), but its resolve
  step checks the dragged pointer's position against a set of day-column
  bounding rects (one ref per column, keyed by date) rather than
  y-to-time math. Returns a drag state (for the column-highlight styling)
  and per-task drag handlers, mirroring `useDragToSchedule`'s
  `{ dragState, getDragHandlers }` shape for consistency.
- **`frontend/src/features/tasks/store.tsx`**: new action
  `rescheduleTaskToDay(id: string, date: string)`. If the current task has
  `repeatSourceId` set, it performs the same two-part update
  `detachFromRoutine` does (clear `repeatSourceId` on the instance, add its
  *original* date to the anchor's `excludedDates`) and *also* sets the new
  `scope.date` in the same dispatched update to the instance (not two
  separate dispatches). Otherwise it's a direct `scope.date` update, same
  shape as every other single-field store action (`setPriority`,
  `setDuration`, etc.).
- **`frontend/src/features/tasks/components/scope-tasks.tsx`**: gains an
  optional `getDragHandlers` prop, applied per-task the same way
  `DayAgenda`'s `renderCard` already does — a drag-handled wrapper around
  each task's existing `<ul><TaskItem /></ul>` — so passing nothing
  (Monthly/Yearly's existing usage) is unaffected.
- **`frontend/src/features/tasks/components/views/weekly-view.tsx`**: wires
  the new hook, adding one ref per day column (an object keyed by date, not
  a fixed-size array, since the exact dates change with the visible week),
  passing `getDragHandlers` down to each column's `ScopeTasks`, and
  applying the highlight styling to whichever column's ref matches the
  current drag state's target date.

## Non-goals

- No within-day reordering.
- No dragging onto Monthly or Yearly views (out of scope; those don't use
  a day-column grid layout).
- No dragging a task onto a day outside the currently visible week (e.g.,
  no auto-advancing to next/previous week by dragging to a grid edge) —
  the Weekly grid only ever shows one week at a time, and this feature
  doesn't change that.
- No changes to the anchor task itself beyond `excludedDates` — its own
  `repeatWeekdays` pattern and its own `scope` are untouched by dragging
  one of its generated instances.
- No refactor of `useDragToSchedule` or extraction of a shared pointer-drag
  primitive in this pass (see Scope decisions above).

## Testing

- `use-drag-to-reschedule-day.ts`: unit tests following the same shape as
  any existing coverage of `useDragToSchedule`'s gesture mechanics (drag
  threshold, resolving the correct day column from a pointer position,
  same-day drop producing no callback).
- `store.tsx`: a test for `rescheduleTaskToDay` covering both branches —
  a plain task's `scope.date` updates directly; a repeat-instance detaches
  (matching `detachFromRoutine`'s existing test coverage shape) while also
  landing on the new date, and the anchor's `excludedDates` gains the
  *original* date, not the new one.
- `scope-tasks.tsx`: existing tests must keep passing unchanged when
  `getDragHandlers` isn't passed; add coverage confirming drag handlers are
  applied per-task when it is.
- `weekly-view.tsx`: coverage for the column-highlight-while-dragging
  behavior and for a drop actually moving a task between two columns,
  following this codebase's existing patterns for testing drag interactions
  (pointer event sequences via `fireEvent`/`userEvent`, as used elsewhere
  for the Daily drag-to-schedule tests).
