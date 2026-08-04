# Weekly View: Drag Handle for Reorder + Reschedule

**Date:** 2026-08-04
**Status:** Approved

## Problem

Every card in a Weekly day column is already a drag source for the
existing drag-to-reschedule feature (`useDragToRescheduleDay`, dragging a
card from one day's column to another). The whole card is also the click
target for opening the detail drawer — the same conflict Daily had before
its drag handle shipped: a short/ambiguous drag is misread as a click,
popping the detail drawer open instead of completing the drag. Separately,
Weekly has no within-day manual reordering at all — untimed tasks in a
column render in whatever order the server returned them, same problem
Daily's "All Day To-Do" list had before the `order` field existed.

## Goal

Add a dedicated drag handle to Weekly's task cards, replacing the
whole-card drag gesture. The same handle drives two outcomes depending on
where it's dropped: reorder within the task's current day, or reschedule
it to a different day.

## Scope decisions (brainstormed and approved)

- **One handle, two outcomes, resolved at drop time.** Drop within the
  task's own day's column → reorder. Drop on a different day's column →
  reschedule (the existing `rescheduleTaskToDay` behavior, unchanged in
  its own right). Drop outside every column → cancel, nothing dispatched.
- **Same-day reorder is untimed-only.** A dragged task's insertion targets
  are only that day's *other untimed* tasks — never timed ones, and a
  timed task dropped within its own day is a no-op with no insertion
  indicator shown. This mirrors Daily's own restriction ("Next Up" is
  time-sorted, not manually reorderable) and avoids a real bug the first
  draft of this design had: `order` only breaks ties between two untimed
  tasks, so allowing "reorder" on a timed task would silently do nothing
  visible after persisting a value — a gesture that appears to work but
  doesn't. Unlike Daily, "untimed" here is not further restricted to
  "not done" — Weekly has no separate Done section to exclude from the
  way Daily excludes "Done Today," and the existing reschedule behavior
  already applies to done tasks. So a done, untimed task is both a valid
  thing to drag (for reorder or reschedule) and a valid insertion-target
  sibling for another untimed task's same-day reorder.
- **The handle is visible on every day-scoped card regardless of
  timed/untimed/done** — because it still needs to serve the
  cross-day-reschedule case for all of them, matching
  `useDragToRescheduleDay`'s current behavior ("applies to all
  day-scoped tasks in a column, done or not"). Only the *same-day*
  outcome is restricted to untimed tasks; cross-day rescheduling is
  unrestricted, same as today.
- **A cross-day move of an untimed task appends to the destination day's
  untimed list**, rather than carrying over whatever `order` value it had
  on its old day (which could land it at an arbitrary position with no
  relationship to the user's intent). Uses the same
  `max(existing) + 1` pattern `addTask` already uses. A cross-day move of
  a *timed* task needs no such handling — its position is always
  determined by `time`, not `order`.
- **`order` is treated as an app-wide concept, not a Weekly-local one.**
  `compareTasksForDay`'s existing no-op tie-break for two untimed tasks
  becomes an `order` comparison. This function is also used by Monthly's
  day-cell preview and a week-level task rollup — both already sort mixed
  timed/untimed lists with an arbitrary tie for untimed pairs, so both
  pick up the same benefit as Weekly. This is a deliberate, explicit
  choice: if a user drags to sequence their untimed tasks for a day, any
  view showing that day's tasks should reflect it, not just the one they
  dragged in. (Contrast with the drag-gesture *hooks*, which stay
  independent per view — that rule exists because gesture-handling code
  is complex and stateful; this is a 6-line pure comparator with one
  existing test file.)
- **`useDragToRescheduleDay` is deleted** once the new combined hook fully
  replaces its usage in `weekly-view.tsx` and its existing test scenarios
  all have an equivalent covered by the new hook's tests. Nothing else in
  the codebase uses it.
- **`useDragToSchedule` (Daily's timeline drag) is untouched.** Unrelated
  to this feature.

## Card layout

Settled through visual iteration (mockups in
`.superpowers/brainstorm/254-1785868332/content/`, screens
`weekly-card-layout.html` through `-v5.html`):

- New `TaskItem` size variant, `size="week"`, alongside the existing
  `"default" | "large" | "timeline"`.
- The handle (`GripVertical`, always visible — no hover-reveal, matching
  Daily's own choice) sits at the left edge, followed by the checkbox.
- **When the task has any metadata to show** (time, subtask count, or a
  repeat cadence), line 1 holds: handle, checkbox, repeat cadence label
  (e.g. "Mo/We/Fr", "Weekdays", "Daily" — exactly what
  `repeatLabelForTask`/`repeatCadenceLabel` already produce; no new
  formatting logic) immediately after the checkbox, then time + subtask
  count grouped together at the right edge. Line 2 holds the title.
- **When the task has no metadata at all**, it collapses to a single
  line: handle, checkbox, title — a long title wraps naturally instead of
  sitting under a near-empty metadata row.
- A cadence label that would collide with the right-hand time/subtask
  group truncates with an ellipsis rather than breaking the row (the
  worst case: a 4-day custom cadence + a time + a double-digit subtask
  count all present at once).
- **No legacy badges on `size="week"` — confirmed decision, not a gap.**
  The `default` size renders a due-date/overdue badge, a "Priority"
  badge, a "Background" badge and a "rolled over" icon. The week card
  deliberately shows none of them: its content is exactly handle,
  checkbox, repeat cadence label, time, subtask count and title. Asked
  directly during review whether these should be restored, the answer was
  to keep them dropped — the compact layout's minimalism is the point, in
  a column roughly a seventh of the screen wide. Pinned by a test in
  `task-item.test.tsx` (the `size="week"` block) so reintroducing or
  further trimming this set has to be a deliberate, visible choice.

## Interaction design

- **The handle's `onPointerDown` stops propagation**, same reasoning as
  Daily's handle — without it, a handle-drag would also start whatever
  the card's other pointer handlers do.
- **While dragging over the task's own day**, and the dragged task is
  untimed: an insertion line shows between the two nearest untimed cards
  in that column, updating live — same visual language as Daily's
  indicator.
- **While dragging over a different day's column**: that column gets the
  existing highlight treatment (ring/background tint), matching
  `useDragToRescheduleDay`'s current behavior exactly.
- **While dragging a timed task within its own day**: no indicator of any
  kind — there is nothing to preview, since the drop would be a no-op.
- **On drop:**
  - Same day, untimed, resolves to a real position change → `setOrder`.
  - Same day, untimed, resolves to its current position → no-op, no
    dispatch (mirrors Daily's same-position guard).
  - Same day, timed → no-op regardless of where within the column it's
    dropped.
  - Different day → `rescheduleTaskToDay(id, date)`, extended (see
    below) to also set an appended `order` when the task is untimed.
  - Outside every column → cancel; the task keeps its original day and
    order, nothing dispatched or saved.
- **Sync failures** fall into the existing `handleSyncFailure` path — no
  feature-specific error handling.

## Implementation approach

- **`frontend/src/features/tasks/lib/times.ts`**: `compareTasksForDay`'s
  branch for two untimed tasks (`a.time` and `b.time` both falsy) changes
  from `return 0` to `return a.order - b.order`.
- **`frontend/src/features/tasks/store.tsx`**: `rescheduleTaskToDay(id,
  date)` — when the resolved task is untimed, additionally compute
  `order` as `max(existing untimed tasks' order for the destination
  date) + 1` (same shape as `addTask`'s computation) and include it in
  the same dispatched update. Timed tasks: no change to this action's
  existing behavior.
- **`frontend/src/features/tasks/components/use-drag-to-reschedule-or-reorder.ts`**
  (new, replaces `use-drag-to-reschedule-day.ts`, which is deleted along
  with its test file): a pointer-gesture hook combining both existing
  hooks' resolution strategies — day-column bounding-rect containment
  (from `useDragToRescheduleDay`) plus per-item insertion-position
  resolution scoped to the dragged task's own day's untimed siblings
  (from Daily's `useDragToReorder`). Takes the dragged task's own
  `scope.date` and whether it's timed as inputs to know which resolution
  branch applies. Returns a drag state distinguishing three outcomes
  (same-day reorder target, different-day reschedule target, outside/
  cancel) and calls the appropriate one of `onReorder`/`onReschedule` on
  drop — never both.
- **`frontend/src/features/tasks/components/task-item.tsx`**: new
  `size="week"` rendering branch per the Card Layout section above.
- **`frontend/src/features/tasks/components/scope-tasks.tsx`**: gains a
  way to request the new `size="week"` `TaskItem` rendering and to wire
  the new hook's per-task handle handlers, analogous to how
  `getDragHandlers` already threads through today.
- **`frontend/src/features/tasks/components/views/weekly-view.tsx`**:
  wires the new hook in place of `useDragToRescheduleDay`, passing both
  day-column refs and the new size/handle-related props down to
  `ScopeTasks`.

## Non-goals

- No changes to `useDragToSchedule` (Daily's timeline drag).
- No reordering of timed tasks, in Weekly or anywhere else — `time`
  remains the sole ordering signal for timed tasks.
- No changes to Monthly's or the week-rollup's own rendering/interaction
  beyond the passive sort-tiebreak improvement `compareTasksForDay`
  already gives them — no drag-and-drop is added to either.
- No order-value rebalancing pass for floats drifting close together
  (same deferral Daily's design already made).
- No keyboard-accessible reordering (matches Daily's own deferral).

## Testing

- `times.ts`: `compareTasksForDay` — two untimed tasks now break ties by
  `order`; existing timed-vs-timed and timed-vs-untimed cases unchanged.
- `store.tsx`: `rescheduleTaskToDay` — untimed task moved cross-day gets
  an appended `order` for the destination day; timed task moved cross-day
  has its `order` untouched (irrelevant to its sort position).
- `use-drag-to-reschedule-or-reorder.ts`: unit tests covering all three
  resolution branches (same-day untimed → insertion position among
  untimed siblings only; same-day timed → no-op/no indicator; different
  day → target date, any timed/untimed/done combination; outside every
  column → cancel), plus every scenario
  `use-drag-to-reschedule-day.test.tsx` currently covers, before that
  file is deleted.
- `weekly-view.tsx`/`scope-tasks.tsx`: integration coverage that a
  same-day untimed drag calls `setOrder` and not `rescheduleTaskToDay`;
  a cross-day drag (any timed/untimed/done combination) calls
  `rescheduleTaskToDay` and not `setOrder`; a same-day timed drag calls
  neither; the two mutations are never both triggered by one drop.
- `task-item.tsx`: `size="week"` rendering — collapses to one line with
  no metadata, shows the metadata row when any of time/subtasks/repeat
  is present, cadence label truncates rather than colliding with the
  time/subtask group.
