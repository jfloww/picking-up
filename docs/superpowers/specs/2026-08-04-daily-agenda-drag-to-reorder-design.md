# Daily Agenda: Drag-to-Reorder

**Date:** 2026-08-04
**Status:** Approved

## Problem

Every card in Daily's agenda panel (`day-agenda.tsx`) is already a drag
source for the existing drag-to-schedule feature (`useDragToSchedule`,
dragging a card onto the timeline to give it a time). There is no
"reorder within the list" gesture at all, and no persisted manual order —
"All Day To-Do" tasks render in whatever order the server returned them
in (effectively `created_at` order), with no way to change it. Attempting
to drag a card to re-sequence it isn't recognized as a valid
drag-to-schedule gesture, so it falls through and fires as a plain click,
opening the task detail drawer instead — a disruptive false trigger.

## Goal

Let a user pick up an "All Day To-Do" task via a dedicated drag handle
and drop it into a new position within that same list, persisting the
new order immediately — no confirmation step, no separate save action.

## Scope decisions (brainstormed and approved)

- **"All Day To-Do" only.** "Next Up" is already meaningfully ordered by
  `time` — manually reordering it would fight that. "Done Today" is out
  of scope for this pass. No other view (Weekly, Monthly, Yearly, Bucket
  List) is in scope.
- **Independent hook, not a refactor of the existing drag code.** A new
  `useDragToReorder` hook is built alongside `useDragToSchedule`, the same
  way Weekly's drag-to-reschedule feature was built as its own
  `useDragToRescheduleDay` rather than touching Daily's existing, working,
  tested drag implementation. That precedent's reasoning applies
  identically here.
- **A dedicated drag handle, not the whole card.** Each "All Day To-Do"
  card already has `useDragToSchedule`'s handlers on its whole surface
  (the existing drag-to-timeline gesture) — adding a *second*,
  independent whole-card drag gesture on top would be ambiguous. A small
  `GripVertical` handle is the only initiator for reordering; the rest of
  the card keeps its existing click-to-open-details and
  drag-to-schedule-onto-timeline behavior exactly as it works today.
- **Handle is always visible, not hover-only.** Hover doesn't exist on
  touch, and a drag affordance that's invisible on touch defeats the
  point.
- **New tasks land at the end.** `addTask`/`addBucketItem` assign a new
  task's `order` as one past the current maximum among that day's "All
  Day To-Do" tasks.
- **Every task gets a real `order` value from day one** — a one-time
  backend migration backfills existing tasks from their current
  `created_at` sequence, so sort/comparison logic never has to special-
  case an unset value.

## Data model

New field on `Task`, backend and frontend:

- Backend: `order = models.FloatField(default=0)` on the `Task` model.
  Migration includes a `RunPython` data migration backfilling every
  existing row's `order` from its `created_at` order (matching the
  backfill-migration precedent already used for Bucket Categories).
- Frontend: `order: number` (required, not optional) on the `Task`
  interface in `types.ts`. `mapping.ts`'s `ApiTask`/`fromApiPayload`/
  `toApiPayload` pass it through like any other plain field.
- `TaskSerializer` (backend) adds `order` to its fields list.

Ordering is **fractional**, not renumbered integer positions: a drag only
ever changes the single dragged task's `order` to the midpoint between
its new neighbors (or an offset from the one neighbor at a list edge).
Exactly one task changes per drag, exactly one `repo.update(...)` call —
the same shape every other single-field store action in this app already
uses (`setPriority`, `setDuration`, etc.), and the same persistence path
(`repo.update(task).catch(handleSyncFailure)`).

## Interaction design

- **The handle** renders on every "All Day To-Do" card (not "Next Up," not
  "Done Today"), always visible.
- **The handle's `onPointerDown` stops propagation** — without this, a
  handle-drag would also kick off `useDragToSchedule`'s existing
  card-level gesture, since the card is already wrapped in that hook's
  handlers.
- **While dragging**, a horizontal insertion line shows between the two
  cards nearest the pointer within the "All Day To-Do" list, updating
  live as the pointer moves — the same visual vocabulary this app already
  uses for drag feedback (Daily's dashed timeline preview, Weekly's
  column highlight), adapted to a list-insertion indicator.
- **On drop over a valid position**, the dragged task's `order` updates
  immediately to the midpoint of its new neighbors — optimistic UI update
  via the existing reducer/dispatch pattern, followed by
  `repo.update(...).catch(handleSyncFailure)`.
- **Dropping in the same position** (no actual change) is a no-op: no
  dispatch, no save call.
- **Releasing outside the "All Day To-Do" list** cancels the drag: the
  task keeps its original order, nothing is dispatched or saved.
- **Sync failures** fall into the existing resync-and-error-banner path
  (`handleSyncFailure`) — no feature-specific error handling.

## Implementation approach

- **`frontend/src/features/tasks/lib/reorder.ts`** (new): pure function
  `computeOrderBetween(before?: number, after?: number): number` —
  midpoint of two neighbors, or an offset from whichever single neighbor
  exists at a list edge (dropped at the very top or very bottom).
- **`frontend/src/features/tasks/components/use-drag-to-reorder.ts`**
  (new): a pointer-gesture hook shaped like `useDragToSchedule` and
  `useDragToRescheduleDay` (threshold detection,
  `setPointerCapture`/`releasePointerCapture`, click-suppression), whose
  resolve step checks the dragged pointer's position against sibling
  card bounding rects (one ref per visible "All Day To-Do" card) to
  determine insertion position, then calls `computeOrderBetween` for the
  new value. Returns `{ dragState, getDragHandlers }`, mirroring the
  other two hooks' shape.
- **`frontend/src/features/tasks/store.tsx`**:
  - New action `setOrder(id: string, order: number)` — direct
    single-field update, same shape as `setPriority`.
  - `addTask` computes the new task's `order` as `max(existing "All Day
    To-Do" tasks' order for that day) + 1` when creating a day-scoped,
    untimed task (i.e. an addition through `day-agenda.tsx`'s own
    QuickAdd, which is exactly how new "All Day To-Do" items get created);
    every other scope kind just defaults to `0`, since `order` is only
    ever read when rendering this one list. `addBucketItem` is unrelated
    to this list and needs no changes.
- **`frontend/src/features/tasks/components/day-agenda.tsx`**: renders
  the `GripVertical` handle on "All Day To-Do" cards only, wires the new
  hook's per-card handlers to the handle (with `stopPropagation` on
  `onPointerDown`), sorts "All Day To-Do" by `order` before rendering,
  and renders the insertion-line indicator while `dragState` is active.

## Non-goals

- No reordering of "Next Up" or "Done Today."
- No cross-day dragging — that's Weekly's existing drag-to-reschedule
  feature, untouched by this one.
- No changes to `useDragToSchedule` or `useDragToRescheduleDay`.
- No drag-and-drop in Bucket List, Monthly, or Yearly views.
- No order-value rebalancing pass for floats that drift very close
  together over many reorders — a real but rare edge case, not worth
  solving until it's actually observed.

## Testing

- `reorder.ts`: unit tests for `computeOrderBetween` — no neighbors
  (first task in an empty list), one neighbor at the top edge, one
  neighbor at the bottom edge, between two existing neighbors.
- `store.tsx`: `setOrder` updates the field and persists via
  `repo.update`; `addTask`/`addBucketItem` assign a new task's `order`
  past the current maximum for day-scoped untimed tasks.
- `use-drag-to-reorder.ts`: unit tests following the same shape as
  `useDragToSchedule`'s existing gesture-mechanics coverage (drag
  threshold, resolving the correct insertion position from a pointer
  position, same-position drop producing no callback).
- `day-agenda.tsx`: the handle renders only on "All Day To-Do" cards;
  existing click-to-select and drag-to-schedule-onto-timeline tests keep
  passing unchanged; a drag via the handle reorders the list and calls
  `setOrder`; a handle-drag does not also trigger the existing
  drag-to-schedule gesture on the same card.
- Backend: migration backfill produces a real `order` value for every
  pre-existing task, consistent with `created_at` order.
