# Promote a Subtask Back to a Main Task

**Date:** 2026-08-05
**Status:** Approved

## Problem

The recently-shipped drag-to-nest feature lets a task become a subtask of
another task, but there's no reverse operation — once nested, a subtask is
stuck as a lightweight `{ id, title, done }` leaf (`types.ts:14-18`) with
no way back to being a standalone task with its own scope, time, memo,
etc.

## Goal

A hover/focus-revealed action on each subtask row in the task detail
drawer (`DrawerSubtaskRow`, `subtask-list.tsx`) that immediately promotes
that subtask into a new standalone task in the parent's scope, with an
Undo affordance afterward.

## Scope decisions (brainstormed and approved)

- **Trigger: a second icon next to the existing Delete button**, not a
  drag gesture. Promoting is a simple, always-available, non-lossy
  operation (unlike nesting, a `Subtask` can never hold more than a
  standalone `Task` can — there's nothing to lose), so it doesn't need
  drag mechanics or a confirmation dialog the way nesting did.
- **Immediate, no confirmation — with Undo instead.** Consistent with
  "promoting never loses data": the action commits right away, and a
  toast offers Undo rather than asking to confirm upfront.
- **Touch-accessible, not hover-only.** `DrawerSubtaskRow`'s existing
  reveal mechanism (`opacity-0` + `group-hover:opacity-100` +
  `group-focus-within:opacity-100`) already has a touch-accessible path —
  tapping the row's title button focuses within the group, revealing both
  action icons. The new promote icon reuses the exact same classes; no
  new CSS mechanism needed.
- **Lives in `TaskDetailDrawer`, not per-view.** `TaskDetailDrawer` is
  already the one component shared by all four views (Daily, Weekly,
  Monthly, Bucket List — confirmed each view's `*-view.tsx` renders it).
  The promote action and its undo-toast state live there once, not
  duplicated per view.
- **No blocking/eligibility cases.** Unlike nesting (which had to block
  tasks with their own subtasks or repeat status), promoting a subtask
  can never fail on data grounds — every subtask can always become a
  standalone task.
- **Non-goals:** no drag-based promote gesture; no exact-position
  restoration on Undo (it re-appends to the end of the parent's subtask
  list rather than reinserting at the original index); no change to how
  subtasks are added/toggled/edited/deleted.

## Interaction design

- `DrawerSubtaskRow` gains a second hover/focus-revealed icon (e.g.
  lucide's `ArrowUpRight`), positioned next to the existing delete `×`,
  labeled `Move "<title>" out as its own task` (aria-label, matching the
  existing `Delete ${subtask.title}` convention).
- Clicking it immediately calls the new store action (below) — no
  confirmation step.
- On success, `TaskDetailDrawer` shows a small toast: *"Moved '<title>'
  out as its own task."* with an **Undo** button, positioned
  `fixed`/viewport-anchored (bottom-center) so it isn't clipped by the
  drawer's own `<aside>` bounds — the same reasoning that made the
  nesting feature's confirmation overlay `fixed inset-0` rather than
  drawer-local. Auto-dismisses after ~6 seconds (a bit longer than the
  nesting feature's 4-second blocked-message banner, since this one
  carries an actionable button, not just information).
- Clicking Undo calls the *existing* `convertTaskToSubtask(newTaskId,
  parentId)` action from the nesting feature — the promoted task goes
  right back into the parent's subtasks, appended at the end. This is
  free reuse, not new logic: promote-then-undo is structurally identical
  to nest, just automated instead of drag-triggered.

## Data model

New store action, alongside `addSubtask`/`removeSubtask`/`convertTaskToSubtask`:

```
promoteSubtaskToTask(parentId: string, subtaskId: string): Task | undefined
```

- No-ops (returns `undefined`) if the parent or the subtask isn't found.
- Builds a new `Task`: `id: crypto.randomUUID()`, `title: subtask.title`,
  `done: subtask.done` (carried over, unlike `addTask` which always
  starts `done: false`), `scope: parent.scope` (identical to the
  parent's — this is what makes the promoted task "land in the parent's
  day"), `createdAt: new Date().toISOString()`.
- **Order:** if `parent.scope.kind === "day"` and the parent itself is
  untimed (i.e. the parent lives in "All Day To-Do"), the new task's
  `order` is `computeOrderBetween(parent.order, nextSiblingOrder)` —
  reusing the existing fractional-ordering helper from the drag-to-reorder
  feature (`lib/reorder.ts`) — landing it directly after the parent, per
  the "directly after the parent when ordering allows" requirement.
  Otherwise (parent is timed, or scoped to a bucket/week/month/year),
  there's no manual-order concept to insert into, so it falls back to
  whatever default `addTask`/`addBucketItem` already use for a fresh task
  in that scope.
- Removes the subtask from `parent.subtasks`.
- Dispatches `{ type: "added", task }` for the new task and
  `{ type: "updated", task: updatedParent }` for the parent, followed by
  `repo.create(task)` and `repo.update(updatedParent)`, each
  `.catch(handleSyncFailure)` — same fire-and-forget pattern every other
  store action already uses.

## Non-goals

- No drag-based trigger for promoting.
- No exact-position restoration on Undo.
- No changes to `addSubtask`/`toggleSubtask`/`removeSubtask`/`editSubtaskTitle`.
- No new eligibility/blocking rules — promoting always succeeds.
