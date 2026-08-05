# Drag a Task onto Another Task to Nest It as a Subtask

**Date:** 2026-08-05
**Status:** Approved

## Problem

Subtasks today can only be created by typing a title into a subtask's own
quick-add row (`SubtaskList`/`DrawerSubtaskList`) — there's no way to turn
an existing top-level task into a subtask of another task without manually
retyping its title and deleting the original. The request: drag one task
card and drop it onto another task card to convert it into a subtask.

## Goal

In Daily's agenda list, dragging a task card and dropping it onto another
task card converts the dragged task into a subtask of the target — for
tasks simple enough that nothing meaningful is lost, or after an explicit
confirmation naming exactly what will be lost for tasks that aren't.

## Scope decisions (brainstormed and approved)

- **Daily only.** Weekly, Monthly, and Bucket List are untouched. Daily
  already has the drag infrastructure this builds on; the other views
  would need it built from scratch.
- **Drag the whole card, not a separate handle.** This shares its drag
  *source* with the existing drag-to-schedule gesture (`useDragToSchedule`,
  used by both `DayAgenda` and `DayTimeline`) — both start from the same
  whole-card press. Rather than a second, competing whole-card gesture on
  the same element (which isn't mechanically viable — two hooks can't both
  own `onPointerDown` on one DOM node), nesting becomes a third possible
  *resolution* of that same gesture, alongside "dropped on the rail" and
  "dropped on the all-day zone." This mirrors Weekly's own drag hook,
  which already merges two outcomes (reorder vs. reschedule) into one
  hook with a tagged-union result, for exactly the same reason: shared
  source, different targets.
- **Drop targets are agenda-list cards only** (All Day To-Do, Next Up,
  Done Today) — not the timeline rail's scheduled-task cards. You can
  still *drag from* the rail (the drag source is shared, unchanged); you
  just can't *drop onto* a rail card. Rail cards live in `DayTimeline`, a
  sibling of `DayAgenda` under `DailyView` — including them as targets
  would mean lifting a card-ref map up to the shared parent for no clear
  benefit. The existing grip-handle reorder gesture on All Day To-Do
  cards is untouched (it already `stopPropagation`s its own
  `onPointerDown`, so it never competes with this).
- **A `Subtask` can only hold `title` and `done`** (`types.ts:14-18`) — no
  memo, time, duration, priority, due date, background, category, repeat,
  or its own subtasks. Converting a task with any of that silently
  discards it unless confirmed first (see below).
- **Simple tasks convert immediately, no confirmation.** A task with
  *only* a title and its done state — no memo, time, duration, priority,
  due date, or background — converts on drop with no dialog.
- **Tasks with any of that metadata require confirmation** — a small
  overlay lists exactly which fields will be lost before committing.
- **Tasks that already have their own subtasks are blocked entirely, not
  just warned** — dropping one shows a brief message instead of
  converting. (A `Subtask` can't hold a `subtasks` array — there's no
  "confirm and flatten" option, only a hard stop.)
- **Tasks that are part of a repeat series are blocked entirely** — both
  the recurring anchor (`repeatWeekdays` set) and a generated occurrence
  (`repeatSourceId` set). Removing either has side effects on the rest of
  the series (occurrence removal excludes that date from the anchor,
  per `removeTask`'s existing behavior) that a "here's what you'll lose"
  confirmation doesn't correctly describe — this is a different risk
  class, not just data loss. The blocked message says the task must be
  detached from its repeat series first (the existing "Detach" action in
  the task detail drawer). Once detached, it's a normal standalone task
  and follows the standard rules above.
- **No backend changes.** `Task.subtasks` is already a plain JSON array
  column (`backend/apps/tasks/models.py:55`) round-tripped whole with the
  parent task (`TaskSerializer`, `serializers.py:42`) — converting is a
  pure client-side composition of the existing `PUT` (add to target's
  subtasks) and `DELETE` (remove the source task) the store already does
  for other operations.
- **Non-goals:** un-nesting a subtask back into a full task; drag-reorder
  of subtasks within a task's own subtask list; anything outside Daily.

## Interaction design

### Resolution priority

`useDragToSchedule`'s `resolve()` (currently returns `{ overAllDay, time }`
from checking `allDayZoneRef` then `railRef`) becomes a tagged union,
checked in this order — most specific target first:

1. **Over another agenda card** (not itself) → `{ kind: "nest",
   targetId }` if the dragged task is eligible (see blocking rules
   above), or `{ kind: "nest-blocked", reason: "has-subtasks" |
   "repeating" }` if not. Hit-tested against a new card-ref map built by
   `DayAgenda` (the same technique `use-drag-to-reorder.ts` already uses
   for its own list — `reorderItemRefs`, but covering every rendered
   card, not just "All Day To-Do"'s).
2. **Over the all-day zone** → `{ kind: "clear-time" }` (today's
   `overAllDay: true`).
3. **Over the rail** → `{ kind: "schedule", time }` (today's existing
   behavior).
4. **Outside everything** → `{ kind: "outside" }`.

### Visual feedback while dragging

- Hovering a *valid* nest target: the target card gets a highlight ring
  in the brand accent color (same vocabulary as other drag affordances
  in this app — Weekly's column highlight, the reorder insertion line).
- Hovering a target that would be *blocked* for this particular drag: a
  muted/subtle ring instead — visible feedback that this is a
  recognized drop zone, without implying the drop will succeed.
  Eligibility depends only on the *dragged* task (has subtasks? part of
  a repeat series?), not on which card it's hovering — so this can be
  computed once when the drag starts, not re-evaluated per hover.
- Dropping on a blocked target shows the explanatory message (see below)
  instead of converting; the dragged task returns to its original state
  untouched, same as dropping outside any valid zone today.

### Confirmation overlay

New small purpose-built component (this app has no dialog/modal
primitive today — task deletion's confirmation is an inline footer
button-swap inside the already-open drawer, which doesn't fit a
drop-triggered interaction). A centered card with a backdrop:

- Names the target task and lists exactly which fields will be dropped
  (e.g. "This will lose: due date, priority").
- Cancel / Confirm buttons, Confirm styled with the same destructive
  accent already used for delete-confirm
  (`border-destructive/40 bg-destructive/10 text-destructive`).
- Escape or backdrop-click cancels — task stays exactly as it was,
  nothing has been dispatched yet at this point.
- Only on Confirm does the actual conversion fire.

### Blocked-drop messaging

Reuses the existing sync-error `Alert` banner slot already rendered at
the top of the agenda (`task-calendar.tsx:97-112`, currently used for
save/sync failures) rather than inventing a new toast system — shown
briefly for:
- *"This task already has subtasks and can't be nested."*
- *"Repeating tasks must be detached from their series first."*

## Data model

New store action in `store.tsx`, alongside the existing
`addSubtask`/`removeTask`:

```
convertTaskToSubtask(taskId: string, targetId: string): void
```

- No-ops (defensively — the UI-layer checks above should already have
  prevented the call) if: `taskId === targetId`; the source task already
  has subtasks; the source task has `repeatWeekdays` set or
  `repeatSourceId` set; either task isn't found.
- Otherwise: appends `{ id: crypto.randomUUID(), title: source.title,
  done: source.done }` to the target task's `subtasks` array (same shape
  `addSubtask` already builds) and removes the source task — the same
  two operations `addSubtask` and `removeTask` already perform
  individually, composed into one action. Follows the same
  fire-and-forget + `repo.update`/`repo.remove` +
  `.catch(handleSyncFailure)` pattern every other store action already
  uses — no new rollback/transaction logic. If the two network calls
  don't both land (e.g. the target update succeeds but the source
  removal fails), the existing sync-error banner and retry-on-reload
  behavior apply exactly as they would for any other partial-failure
  today; this isn't a new failure mode to design around.

## Non-goals

- Weekly, Monthly, Bucket List.
- Un-nesting a subtask back into a standalone task.
- Drag-reordering within a subtask list.
- The timeline rail as a drop target.
- Any change to `removeTask`'s existing repeat-anchor-exclusion
  side-effect logic — repeat tasks are blocked from this feature
  entirely, so that logic is never reached from this path.
