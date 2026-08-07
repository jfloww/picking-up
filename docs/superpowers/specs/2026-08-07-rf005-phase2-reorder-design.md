# Design: RF-005 Phase 2 — Reorder command and server-owned creation order

- Date: 2026-08-07
- Issue: RF-005 (final remaining piece — completing this closes RF-005)
- Status: Approved by owner, not yet implemented

## Problem

`docs/superpowers/specs/2026-08-06-rf005-occurrence-commands-design.md` and
its implementation closed Detach, Delete-occurrence, and Reschedule as
atomic, versioned server commands (Phase 1). Reorder was explicitly deferred
to this phase.

Two related gaps remain, both about `Task.order` being client-authoritative:

1. **Drag-to-reorder is client-computed.** Both `day-agenda.tsx` (Daily's
   "All Day To-Do") and `weekly-view.tsx` (each day's column) resolve a drag
   to a neighboring Task ID (`insertBeforeId`), then compute a raw order
   float client-side (`computeOrderBetween`) and send it via a generic PUT.
   This is the same client-authority problem Nest/Promote/Detach/Reschedule
   already closed for their own domains — just not yet closed for reorder.
2. **Task creation accepts an arbitrary client-supplied `order`.** The
   Promote command's own doc already flags the consequence: `POST
   /api/tasks/` takes no owner lock and accepts a client-supplied `order`
   float, so an ordinary concurrent task creation can land at an ambiguous
   position while a Promote command is mid-flight — a duplicate/ambiguous
   `order` value, not corruption, but real client authority over server
   state.

Closing both removes every remaining code path that writes `Task.order`
from client input, matching the "close the remaining client authority"
line from Phase 1's own design doc.

## Scope

In scope: one new `Reorder` command endpoint, used identically by both
Daily and Weekly's drag-to-reorder handlers; making task creation's `order`
server-computed instead of client-supplied.

Out of scope: generic `PUT` on an existing task keeps accepting `order` for
now. After this phase the frontend will simply never send it there, but the
design doc's own wording only calls out `POST /api/tasks/`
(creation) — stripping `order` from the general-purpose update endpoint too
is a separate hardening this phase doesn't claim.

## Ground truth this design is built on

- `frontend/src/features/tasks/components/use-drag-to-reorder.ts` (Daily)
  and the Weekly-specific drag hook both already resolve a drop to
  `insertBeforeId: string | null` — "structural intent," not a float. Only
  the order *value* is computed client-side today, in
  `day-agenda.tsx`/`weekly-view.tsx`'s own `onReorder` handlers, via
  `frontend/src/features/tasks/lib/reorder.ts`'s `computeOrderBetween`.
- **Weekly and Daily use different membership rules for their reorderable
  sibling set, and this is pre-existing, not something introduced here.**
  Daily's `allDayToDo` explicitly filters `!isDone(t)` — done tasks never
  appear in its draggable list at all. Weekly's `orderedIdsByDate` uses
  `dayTasksForWeek(tasks, date, weekStart).filter((t) => !t.time)` with
  **no** done-filter — done and not-done untimed tasks are interleaved in
  one order-sorted list per day-column.
- `backend/apps/tasks/services.py`'s `reschedule_task` (Phase 1) already
  computes a destination-day order server-side using exactly the rule this
  design reuses: `Q(scope_kind="day", scope_value=date) |
  Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)`,
  untimed, **not** filtered by `done` — chosen there specifically because
  Weekly needs done tasks counted. The same rule is correct for Reorder.
- Weekly has no task-creation UI (`QuickAdd` only exists in
  `day-agenda.tsx`) — creation is always plain day-scope. It never needs to
  consider rolled-over week-scoped siblings the way Reschedule/Reorder do.
- `frontend/src/features/tasks/lib/reorder.ts`'s `nextUntimedOrderFor`
  (today's creation-order logic) filters `scope.kind === "day" &&
  scope.date === date && !t.time && !t.done` — day-scope only, excludes
  done. This design preserves that rule exactly for creation; only *where*
  it's computed changes (server instead of client).

## Reorder command

```http
POST /api/tasks/{id}/commands/reorder/
Content-Type: application/json

{
  "task_version": 3,
  "insert_before_id": "<uuid> | null"
}
```

`insert_before_id: null` means "move to the end of the list."

```json
200 OK
{
  "task": { "id": "...", "version": 4, "order": 12.5 }
}
```

No secondary/anchor object — Reorder never touches a second Task row, so
there is no optional second key in the response, and no data-loss
confirmation step.

Steps, atomically:

1. Lock owner, lock the task, check `task_version` (`409
   task_version_conflict` on mismatch).
2. Reject `409 not_reorderable` if the task is timed (`time` set) or has no
   resolvable effective date (`_current_effective_date` returns `None`) —
   position is meaningless for a timed task; its display order is driven by
   `time`, not `order`.
3. Lock the eligible sibling set using the same query `reschedule_task`
   already uses: `Q(scope_kind="day", scope_value=date) |
   Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)`,
   untimed, not filtered by `done` — where `date` is the task's own
   `_current_effective_date`.
4. Reject `409 invalid_neighbor` if `insert_before_id` is non-null and
   doesn't resolve to a task inside that locked, owned sibling set. One
   check covers "doesn't exist," "wrong day," "cross-owner," "is itself
   timed," and "is the task being reordered" without distinguishing them —
   consistent with this project's existing disclosure-safety posture (a
   cross-owner Task looks identical to a nonexistent one everywhere else in
   this API).
5. Compute the new `order` as the midpoint between the sibling immediately
   before and immediately after the insertion point — the same edge-gap and
   midpoint logic `computeOrderBetween` already implements client-side, now
   evaluated against the locked, authoritative sibling list instead of a
   client-held snapshot.
6. Save the task, bump its version.

**No `neighbor_version` required.** `insert_before_id` names a task whose
current `order` is read to compute a midpoint — never written. A stale read
of that neighbor cannot cause data loss (worst case, the computed midpoint
lands between two siblings whose exact positions have since shifted
slightly, still landing in a reasonable place); the only precondition that
matters is `task_version` on the row actually being written. This mirrors
the "no anchor_version" reasoning from Phase 1's `_append_anchor_exclusion`.

The command's own row-lock ordering follows the existing precedent from
`reschedule_task`: lock owner, then the primary task, then the sibling set —
not a fresh design decision.

## Creation's order

`order` is removed from `TaskSerializer`'s writable-on-create fields — the
same treatment `version`/`created_at`/`completed_at` already receive
(present on read, ignored or rejected on write). `TaskListCreateView`'s
`perform_create` computes the initial `order` server-side using the exact
rule `nextUntimedOrderFor` already implements client-side: among the
requesting user's existing day-scoped, untimed, not-done tasks on the same
`scope_value`, `max(existing orders, 0) + 1`.

This closes the ambiguous-concurrent-create race the Promote doc already
flagged, without changing what a freshly created task's position actually
looks like — the rule is identical to today's client computation, just
authoritative and race-safe (computed under the same owner-row lock every
other command already takes) instead of trusted from the request body.

## Testing plan

Same shape as the existing command tests in `TaskCommandApiTests`:

- version/ownership preconditions for the primary task;
- `not_reorderable` for a timed task;
- `invalid_neighbor` for each distinct case that collapses into it:
  nonexistent ID, cross-owner task, a task on a different day, a timed
  task, and the task's own ID;
- correct midpoint math for both list-edge cases: `insert_before_id: null`
  (append past the last sibling) and inserting before the first sibling
  (no `before` neighbor);
- a Weekly-shaped case proving a **done** sibling is honored in the order
  calculation — the one place this command's behavior differs from what
  Daily alone would suggest;
- a create-time test proving a client-supplied `order` in the request body
  is ignored and the server-computed value (matching
  `nextUntimedOrderFor`'s rule) is what actually gets stored.

Frontend: replace `day-agenda.tsx` and `weekly-view.tsx`'s local
`computeOrderBetween` + `actions.setOrder` sequences with a single command
call each, following the established `requestDetachTask`/
`requestRescheduleTask` pattern (typed request, BFF route passthrough,
`applyCommandState` on success). `computeOrderBetween` itself is not
deleted — `promotedSubtaskOrder` in the same file still uses it for the
promote-a-subtask-next-to-its-parent case, which is unrelated to this
design and stays client/service-side as already implemented.

## Open items intentionally deferred

- Generic `PUT`'s continued acceptance of a client-supplied `order` on an
  existing task — not stripped this phase, per the Scope section above.
- Command idempotency after an ambiguous network timeout remains
  unimplemented, same accepted gap noted for every other command in this
  family.
- Completing this phase lets `docs/refining/README.md`'s RF-005 row move
  from **In progress** to **Resolved** — that row update is part of the
  implementation plan's wrap-up, not a separate task, matching how Phase
  1's plan handled its own "after all tasks" documentation step.
