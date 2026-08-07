# Design: RF-005 Phase 1 — Detach, Delete-occurrence, Reschedule commands

- Date: 2026-08-06
- Issue: RF-005 (remaining work, phase 1 of 2 — Reorder is phase 2, designed separately)
- Status: Approved by owner, not yet implemented

## Problem

`docs/refining/2026-08-06-transactional-task-commands.md` already implements
Nest and Promote as atomic, versioned server commands, replacing client-owned
generic CRUD sequences. Four command families were left client-owned:
Detach, Delete-occurrence, Reschedule, and Reorder.

This design covers the first three. They share a shape Reorder does not:
each mutates one occurrence Task and, when that occurrence is linked to a
repeat anchor, must also atomically append the occurrence's original date to
the anchor's `excluded_dates` — otherwise the next client materialization
pass resurrects a task the user just detached, deleted, or moved.

Today the frontend (`frontend/src/features/tasks/store.tsx`:
`detachFromRoutine`, `removeTask`, `rescheduleTaskToDay`) performs this as
two separate, non-atomic mutation-queue entries: one write for the
occurrence, one for the anchor. A post-merge review already found and fixed
the symptom this causes (`excludedDates` rebasing as a whole-array overwrite
instead of a union, which could silently drop a concurrent exclusion — see
that doc's "Post-merge review round" section). The underlying cause is still
present: two independent backend writes can partially fail, or race against
a concurrent command for the same occurrence, leaving the anchor unaware an
occurrence was removed. This is the same defect class Nest/Promote were
built to close for their own pairs of Task writes. Folding each of these
three pairs into one `transaction.atomic()` service function removes it
structurally, the same way Nest/Promote already did.

## Scope

In scope: Detach, Delete-occurrence, Reschedule as new command endpoints
under `backend/apps/tasks/`, plus the frontend wiring to call them instead
of the current two-step generic-CRUD sequence.

Out of scope: Reorder (phase 2 — structurally different, no anchor
involved, and it's what closes the promotion sibling-locking gap noted in
the Nest/Promote doc by finally removing the client-supplied `order` field
from task creation). RF-017's server-owned materialization race is a
separate, adjacent problem and is not addressed here.

## Shared contract

All three commands follow the existing Nest/Promote shape:

- One `services.py` function per command, wrapped in `@transaction.atomic`,
  reusing `_lock_user`/`_locked_owned_tasks` for row locking rather than
  duplicating it.
- One thin `serializers.py` command serializer per command.
- One view method per command, at `POST /api/tasks/{task_id}/commands/<verb>/`.
- A Next.js BFF route per command that passes through Django's status and
  body verbatim, including `409`, matching the existing Nest/Promote routes.
- `404 Not Found` for a missing or cross-owner task, matching Nest/Promote's
  disclosure-safe behavior (a cross-owner task looks identical to a missing
  one).

**Anchor versioning:** none of the three commands require the client to
supply an `anchor_version`. Only the primary touched task (the occurrence,
or the task being rescheduled) carries a client-supplied version
precondition. The service locks the owning user row — the same
serialization guarantee `_lock_user()` already gives Nest/Promote — then
resolves the anchor via `repeat_source` and appends the excluded date as a
set union, not a whole-array replace. A stale read of the anchor cannot
cause data loss here the way a stale Nest target could, because the write
is additive and idempotent (adding the same date twice is a no-op), so
gating it behind a client-supplied version would only add failure modes
without closing a real one.

## Detach

```http
POST /api/tasks/{occurrence_id}/commands/detach/
Content-Type: application/json

{
  "occurrence_version": 3,
  "repeat_weekdays": [2, 4]
}
```

`repeat_weekdays` is optional, matching the current
`detachFromRoutine(id, weekdays?)` signature — detaching can either leave
the task fully standalone or immediately establish it as a new anchor.

```json
200 OK
{
  "occurrence": { "id": "...", "version": 4 },
  "anchor": { "id": "...", "version": 9 }
}
```

`anchor` is omitted from the response when the occurrence had no
`repeat_source` to begin with.

Steps, atomically:

1. Lock owner, lock the occurrence, check `occurrence_version` (`409` on
   mismatch).
2. Clear `repeat_source`; set `repeat_weekdays` from the body if provided,
   otherwise leave it unset.
3. If the occurrence had a `repeat_source`, lock that anchor and append the
   occurrence's `scope_value` to the anchor's `excluded_dates` (union, not
   replace — a concurrent exclusion already present must survive).

Detaching a task with no `repeat_source` at all (already standalone) is not
an error — it succeeds and touches no anchor, matching today's client
behavior for that case (see `store.test.tsx`: "detaching a task that was
already standalone... does not touch any anchor").

## Delete-occurrence

```http
POST /api/tasks/{occurrence_id}/commands/delete-occurrence/
Content-Type: application/json

{
  "occurrence_version": 3
}
```

```json
200 OK
{
  "removed_task_id": "...",
  "anchor": { "id": "...", "version": 9 }
}
```

`anchor` is omitted when the occurrence had no `repeat_source`.

Steps, atomically:

1. Lock owner, lock the occurrence, check `occurrence_version` (`409` on
   mismatch).
2. Delete the occurrence.
3. If it had a `repeat_source`, lock that anchor and union its date into
   `excluded_dates`, same as Detach.

This is a plain delete with one atomic side effect — no data-loss
confirmation step like Nest, since deleting a task the user targeted
directly isn't a surprising loss of a *different* task's data. The generic
`TaskDetailView.destroy()` remains the delete path for a non-repeat-linked
task or for an anchor itself; this command is specifically for deleting an
occurrence.

## Reschedule

```http
POST /api/tasks/{task_id}/commands/reschedule/
Content-Type: application/json

{
  "task_version": 3,
  "date": "2026-07-20"
}
```

```json
200 OK
{
  "task": { "id": "...", "version": 4 },
  "anchor": { "id": "...", "version": 9 }
}
```

`anchor` is omitted when the task had no `repeat_source`.

Steps, atomically:

1. Lock owner, lock the task, check `task_version` (`409` on mismatch).
2. Reject with `409 same_date` if `date` equals the task's current
   effective date — `scope_value` for a day-scoped task, `rolled_from_value`
   for a rolled-over week-scoped task. This replaces today's silent
   client-side no-op (`rescheduleTaskToDay` just returns early) with an
   explicit, testable conflict code.
3. Reject with `409 not_reschedulable` if the task is neither day-scoped nor
   a rolled-over week-scoped task. Today's client function silently returns
   for anything else; this makes that rule explicit and enforced
   server-side instead of implicit and client-only.
4. Set `scope_kind="day"`, `scope_value=date`; clear `rolled_from_kind`/
   `rolled_from_value`; clear `repeat_source` if it was set.
5. Compute the destination order the same way `services.py`'s
   `_promotion_order` already does for Promote: lock the untimed siblings at
   the destination day and compute from that locked state, rather than
   trusting a client-submitted order. This closes the same
   "someone-inserts-between-siblings" gap noted in the Promote doc, for this
   command. A timed task's `order` is left untouched, matching current
   behavior (`time` drives its position, not `order`).
6. If the task had a `repeat_source`, lock the anchor and union the
   *original* date (the value read in step 2, before the task's scope
   changes) into its `excluded_dates`.

## Testing plan

Same shape as the existing `TaskCommandApiTests`:

- version/`If-Match`-equivalent preconditions for the primary task on each
  command;
- ownership isolation (cross-owner task behaves identically to missing);
- the domain rules specific to each command (Detach's no-op-on-standalone
  case; Reschedule's `same_date`/`not_reschedulable` rejections);
- the union-not-replace behavior for `excluded_dates` — a concurrent
  exclusion present on the anchor before the command runs must still be
  present after;
- one rollback test per command, forcing a mid-transaction failure to prove
  the occurrence/task write and the anchor write either both commit or both
  roll back together (matching the existing Nest/Promote rollback tests).

Frontend: replace the two-step `persistUpdate`/`persistUpdate` sequences in
`detachFromRoutine`, `removeTask`, and `rescheduleTaskToDay` with a single
command call each, following the existing `requestNestTask`/
`requestPromoteSubtask` pattern (typed request, BFF route passthrough,
`applyCommandState` on success). Existing store tests for these three
functions should continue to pass with updated mocks; no new frontend
behavior is being added beyond the atomicity fix itself.

## Open items intentionally deferred

- Reorder (phase 2 of RF-005) is designed separately.
- Command idempotency after an ambiguous network timeout remains
  unimplemented, same as noted for Nest/Promote — a committed command whose
  response is lost may still surface as a conflict on manual retry.
- RF-017 (server-owned routine materialization) is adjacent but separate:
  even with these three commands atomic, two sessions can still
  independently materialize different occurrence UUIDs for the same
  anchor/date. Not addressed here.
