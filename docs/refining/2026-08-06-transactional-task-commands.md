# RF-005 Progress: Transactional Task Commands

- Date: 2026-08-06
- Issue: RF-005
- Status: In progress

**Result:** The first bounded slice is implemented for task-to-subtask nesting
and subtask-to-task promotion. It adds a shared optimistic-concurrency
foundation and explicit transactional backend commands. A second slice, on the
same foundation, adds Detach, Delete-occurrence, and Reschedule as equivalent
transactional commands with full frontend wiring. RF-005 does not close yet:
only Reorder still needs a server-owned command.

The verification numbers in the early checkpoints below are retained as an
audit trail, not presented as current combined-tree totals. Later independent
review found and fixed a broader queue integrity defect; its current contract
and focused 100-frontend/21-backend verification are recorded in
"Independent-review follow-up: safe queue reconciliation." The final PR-wide
suite is recorded in the refinement register rather than rewriting each dated
checkpoint.

## Scope of this slice

This slice replaces the persistence design in the dated nesting and promotion
specs. Those specs remain the record of the approved user interaction, but
their decision to compose independent client-side CRUD requests is no longer
the current reliability contract.

Implemented here:

- a monotonically increasing `Task.version`, initialized to `1` for existing
  and newly created tasks;
- conditional update and delete behavior for generic Task resources;
- an atomic nest command that updates the target and deletes the source as one
  database transaction;
- an atomic promotion command that creates the standalone task and removes the
  source subtask from its parent as one database transaction;
- an atomic detach command that clears an occurrence's `repeat_source`,
  optionally establishes a new repeat schedule, and adds the occurrence's
  original date to its anchor's exclusions;
- an atomic delete-occurrence command that removes the occurrence and adds its
  original date to its anchor's exclusions so the next materialization pass
  cannot resurrect it;
- an atomic reschedule command that moves a task to a new day, clears
  rollover/repeat linkage, excludes the original routine date, and calculates
  destination order from locked server state;
- owner-scoped lookup, row locking, stale-version rejection, and explicit
  domain-conflict responses; and
- Next.js command routes that preserve Django's response status and body,
  including `409 Conflict`.

The command, transport, and frontend wiring are complete for Nest, Promote,
Detach, Delete-occurrence, and Reschedule. This record does not claim every
planner mutation has moved off generic CRUD; Reorder, the one remaining
command family under "Remaining RF-005 work," is still client-owned.

## Optimistic-concurrency contract

Every serialized Task now includes a positive integer `version`.

Generic resource mutations use a quoted version in `If-Match`:

```http
PUT /api/tasks/{task_id}/
If-Match: "3"
```

The same precondition applies to `PATCH` and `DELETE` at the Django boundary.
An accepted update increments the version once and returns the new value. A
successful detail response also exposes the current value as an `ETag`.

Failure behavior is:

- missing `If-Match`: `428 Precondition Required`;
- malformed or unquoted `If-Match`: `400 Bad Request`; and
- a well-formed but stale version: `409 Conflict`, including the current
  server version.

Commands that touch more than one Task carry all expected versions in their
JSON body instead of trying to represent multiple resources in one
`If-Match` header. This is important for nesting: checking only the source
would still allow a stale target subtask array to overwrite another writer's
change.

## Nest command

```http
POST /api/tasks/{source_id}/commands/nest/
Content-Type: application/json

{
  "target_id": "<uuid>",
  "source_version": 3,
  "target_version": 7,
  "subtask_id": "<client-generated-id>",
  "confirm_data_loss": false
}
```

On success, the endpoint returns `200 OK` with the authoritative, incremented
target and the deleted source ID:

```json
{
  "target": { "id": "...", "version": 8 },
  "removed_task_id": "..."
}
```

The service locks the authenticated owner row, then locks the source and
target Task rows in deterministic ID order inside `transaction.atomic()`. The
owner lock serializes command-level sibling/order calculations for one user;
the Task locks protect the concrete aggregates being changed.

Deadlock safety comes from the owner-row lock, not from the ID ordering.
`SELECT ... FOR UPDATE ... ORDER BY id` guarantees lock-acquisition order on
PostgreSQL, where the lock node sits above the sort, but not on Oracle — the
production database — where `FOR UPDATE` acquires locks in access-path order
before the sort applies. Two concurrent commands for the same user are still
deadlock-free, because `_lock_user()` fully serializes them before either
touches a Task row; the ID ordering is redundant defense-in-depth, not the
actual guarantee. This matters if a future change removes the owner lock
(plausible once reorder/reschedule move server-side) on the belief that ID
ordering alone is sufficient — on Oracle, it is not.

The command is scope-agnostic. The current drag-to-nest interaction still
originates in the Daily UI, while promotion Undo uses the same command for
parents in day, week, month, year, and bucket scopes. The server revalidates
the domain rules that apply in every scope:

- a task cannot be nested into itself;
- the source cannot already have subtasks;
- the source cannot be a repeat anchor, generated occurrence, or an anchor
  with generated occurrences;
- the supplied subtask ID cannot already exist in the target; and
- user-visible Task fields are discarded only after explicit confirmation.

The server reports the exact lossy fields it detects. In addition to memo,
time, duration, priority, due date, and background, it treats rollover history
and excluded routine dates as data requiring confirmation. If any check, save,
or delete fails, the target update and source deletion roll back together.

Missing and cross-owner Tasks share the same `404 Not Found` behavior so the
command does not disclose another user's object. Stale source or target
versions and domain-state conflicts return `409 Conflict` without changing
either Task.

## Promote-subtask command

```http
POST /api/tasks/{parent_id}/commands/promote-subtask/
Content-Type: application/json

{
  "subtask_id": "<subtask-id>",
  "parent_version": 4,
  "new_task_id": "<client-generated-uuid>"
}
```

On success, the endpoint returns `201 Created` with the authoritative parent
and new Task:

```json
{
  "parent": { "id": "...", "version": 5 },
  "task": { "id": "...", "version": 1 }
}
```

The service locks the owner and parent inside `transaction.atomic()`. For a
day-scoped parent it also locks the relevant untimed sibling rows before
calculating the promoted Task's fractional order.

Row locks on the sibling rows block concurrent *updates* to those rows, not
inserts between them, so this does not by itself close a read-siblings/
compute-midpoint/someone-inserts-between race. `POST /api/tasks/` accepts a
client-supplied `order` float and takes no owner lock, so an ordinary
concurrent task creation can still land at an ambiguous position while a
promotion is mid-flight. The owner lock closes this race between two
*commands* for the same user; it does not close it against the generic create
endpoint. Net effect today is a duplicate/ambiguous `order` value, not
corruption — but "locks siblings before calculating order" should not be read
as a complete guarantee until reorder also moves server-side.

It then:

- requires exactly one matching subtask ID and rejects ambiguous legacy
  duplicate IDs;
- rejects a new Task UUID already used anywhere in the Task table;
- copies the subtask title and done state;
- copies the parent's scope and bucket-category relationship;
- sets the server-owned completion timestamp when the promoted subtask is
  already done;
- creates the promoted Task at version `1`; and
- removes the subtask and increments the parent version once.

Creation and parent mutation either commit together or roll back together.
Missing and cross-owner parents return `404`; stale parents and domain
conflicts return `409` without a partial create or removal.

## Detach command

```http
POST /api/tasks/{occurrence_id}/commands/detach/
Content-Type: application/json

{
  "occurrence_version": 2,
  "repeat_weekdays": [2, 4]
}
```

On success, the endpoint returns `200 OK` with the authoritative, incremented
occurrence and — if the occurrence had a repeat anchor — the authoritative,
incremented anchor:

```json
{
  "occurrence": { "id": "...", "version": 2 },
  "anchor": { "id": "...", "version": 2 }
}
```

`anchor` is omitted from the body entirely when the occurrence was already
standalone, rather than serialized as `null`.

The service locks the owner row, then the occurrence, inside
`transaction.atomic()`. It clears `repeat_source`, optionally sets a new
`repeat_weekdays` in the same write, and — before doing so, since the clear
would otherwise erase the pointer needed to find the anchor — appends the
occurrence's current effective date to the anchor's `excluded_dates` via the
shared `_append_anchor_exclusion` helper (also used by Delete-occurrence and
Reschedule below). "Current effective date" is `scope_value` for a day-scoped
occurrence, or `rolled_from_value` for a week-scoped occurrence rolled over
from a day — the same rule Reschedule and the frontend's rollover/materialize
logic use, not merely `scope_kind == "day"`.

The anchor write is additive-only: it unions the date into the existing
`excluded_dates` set rather than replacing the array, and is a no-op if the
date is already present, so a concurrent exclusion from another writer always
survives. No `anchor_version` precondition is required — the owner-row lock
already serializes command-level writes for one user, and the write itself is
idempotent.

Missing and cross-owner occurrences share the same `404 Not Found` behavior as
Nest and Promote. A stale occurrence version returns `409 Conflict` with
`code: "task_version_conflict"`, without touching either row.

## Delete-occurrence command

```http
POST /api/tasks/{occurrence_id}/commands/delete-occurrence/
Content-Type: application/json

{
  "occurrence_version": 1
}
```

On success, the endpoint returns `200 OK` with the removed task's ID and — if
it had a repeat anchor — the authoritative, incremented anchor:

```json
{
  "removed_task_id": "...",
  "anchor": { "id": "...", "version": 2 }
}
```

The service locks the owner and the occurrence, appends the occurrence's
current effective date to the anchor's exclusions using the same
`_append_anchor_exclusion` helper Detach uses, then deletes the occurrence row
— all inside one `transaction.atomic()`. Recording the exclusion before the
row disappears is what stops the next client materialization pass from
reading "no occurrence exists for this date" and resurrecting a task the user
just deleted; the older detach/delete design that left the anchor untouched is
superseded by this behavior.

Missing, cross-owner, and stale-version handling match Detach: `404` for a
missing or unowned occurrence (no row deleted), `409` for a stale version (no
row deleted).

## Reschedule command

```http
POST /api/tasks/{task_id}/commands/reschedule/
Content-Type: application/json

{
  "task_version": 1,
  "date": "2026-07-20"
}
```

On success, the endpoint returns `200 OK` with the authoritative, incremented
task and — if it had a repeat anchor — the authoritative, incremented anchor:

```json
{
  "task": { "id": "...", "version": 2 },
  "anchor": { "id": "...", "version": 2 }
}
```

The service locks the owner and the task, then rejects two domain conflicts as
`409` before making any change:

- `not_reschedulable` — the task is neither day-scoped nor a rolled-over
  week-scoped task (month/year/bucket scope, or a week-scoped task with no
  `rolled_from`), so it has no well-defined "current day" to move from;
- `same_date` — the destination date equals the task's current effective
  date, a no-op the caller should have skipped client-side.

Once past those checks, it appends the original effective date to the
anchor's exclusions (same shared helper and additive-union behavior as
Detach/Delete-occurrence), then moves the task: sets `scope_kind`/`scope_value`
to the destination day, clears `rolled_from_kind`/`rolled_from_value` and
`repeat_source`, and — for an untimed task only — recalculates `order` by
locking every untimed sibling already on the destination day (day-scoped
tasks on that date, plus week-scoped tasks rolled over from it) and placing
the moved task past the maximum. A timed task's `order` is left untouched,
since its position is driven by `time`, not `order`. All of this commits or
rolls back together with the anchor write.

Row locks on the destination day's siblings block concurrent *updates* to
those rows, not inserts between them — the same caveat Promote-subtask's
order calculation documents above, and unresolved for the same reason: it
closes the race between two *commands* for one user, not against the generic
create endpoint's client-supplied `order`.

Missing/cross-owner and stale-version handling match the other two commands:
`404` without a body change, `409` with `code: "task_version_conflict"`
without a change.

## Verification checkpoint

The initial RF-005 backend implementation passed this focused SQLite run:

```text
TaskApiTests + TaskCommandApiTests
40 tests passed
```

That run happened before the subsequent backend quality edits and additional
tests were added. It covered the initial version/ETag behavior, required and
stale preconditions, ownership isolation, nest and promotion domain rules,
canonical responses, and transaction rollback paths. It is evidence for the
initial implementation, not a passing result for the current combined tree.

After that checkpoint, the backend command rules and tests changed and the
frontend integration was added. Further process launches were blocked by the
Windows sandbox and approval quota at the time, so none of the following had
yet been executed against the current combined change set.

**Update, 2026-08-06 (independent review):** the block was environmental, not
permanent. The following has now run against the current combined tree:

- Backend, full suite: `manage.py test apps.tasks -v 2` → **72 tests, OK.**
- `manage.py check`: no issues.
- `manage.py makemigrations --check --dry-run`: no changes detected —
  `models.py` and the migration graph agreed at that checkpoint (the graph
  then ended at 0013 after RF-007's final add/backfill/finalize split. It has
  since moved again: a later RF-006 fix added `0014_truncate_overlength_subtask_fields`,
  unrelated to RF-007 — see that row in `docs/refining/README.md` for detail).
- Frontend, full suite: `npx vitest run` → **751 passed, 2 failed**, of 753.
  Both failures are real, not flaky:
  - `store.test.tsx:1250` — the mutation queue now fences out any mutation
    already queued when a sync failure lands (`mutationEpochRef`), so a
    second concurrent update is silently skipped instead of retried. The
    existing test still asserts the pre-fence behavior. This needs a
    decision — is dropping queued mutations on failure the intended
    contract? — before the test can be corrected either way.
  - `api-task-repository.route-integration.test.ts:324` — asserts on a
    `subtasks: undefined` key that `NextResponse.json` strips from the
    actual response body. Test bug; the behavior it checks is otherwise
    correct.
- Frontend typecheck: `npx tsc --noEmit` → **8 errors.** Two are in
  production source, not test fixtures: `repository.ts:297,312` (and an
  identical copy in `test-utils.tsx`) narrow `scope.kind === "day"` in an
  `if`, but the narrowing does not survive into a nested `.filter()`
  callback, so `parent.scope.date` does not typecheck in the promoted-task
  order calculation. The other 6 are test fixtures missing the now-required
  `Task.version` field.
- Frontend lint: `npx next lint` → passes, one new warning
  (`store.tsx:761`, `exhaustive-deps` on a `useMemo`).
- Frontend production build: not attempted — the typecheck failure already
  means `next build` cannot succeed, and a prior attempt hit the known
  Windows `.next/trace` `EPERM` lock from concurrent dev-server processes.
- Oracle integration/contention tests: still not run. Unchanged from before
  this update.

Net effect: the backend half of this checkpoint is now genuinely closed. The
frontend half is no longer merely untested — it is tested and currently
broken. See "Known gaps found during review" below for findings beyond raw
pass/fail counts.

SQLite accepts the transaction code but treats `select_for_update()` as a
no-op. The tests therefore prove validation and rollback behavior, not real
row-lock contention. Concurrent-command behavior still needs verification on
Oracle or another database with row-level locking; this remains connected to
RF-012.

## Known gaps found during review (2026-08-06)

Backend (all four resolved, 2026-08-06):

- `Task.version` was not incremented by cascade side effects. Deleting a
  repeat anchor `SET_NULL`s `repeat_source` on every generated occurrence
  without touching `version`, so a client holding a stale-but-version-
  matching copy of an occurrence could still pass `If-Match` after the
  occurrence's meaning changed underneath it. Fixed in
  `TaskDetailView.destroy()`: occurrences are bumped with
  `Task.objects.filter(repeat_source=instance).update(version=F("version")
  + 1)` in the same transaction as the delete, before the SET_NULL cascade
  runs. Covered by an assertion added to the existing
  `test_deleting_an_anchor_nulls_repeat_source_on_its_occurrences_instead_of_deleting_them`.
  (Category deletion `SET_NULL`ing `bucket_category` has the same
  theoretical gap, but there is no Category delete endpoint today, so it's
  unreachable via the API — left unfixed pending an actual delete endpoint,
  rather than adding speculative code for an unreachable path.)
- No test existed for the "cannot nest a task into itself" rule, despite it
  being the first domain rule this record lists. The implementation was
  already correct (two lines in `services.py`); added
  `test_nest_rejects_nesting_a_task_into_itself`.
- Lossy-field detection for nest was tested for only 2 of the 8 fields this
  record claims are covered. Added
  `test_nest_detects_data_loss_for_every_lossy_field_individually`,
  parametrized over the remaining 6 (time, duration, due date, background,
  rollover history, excluded dates) — all pass, confirming the
  implementation was already correct; this closes the test-coverage gap.
- Two different mechanisms produced a 409: `TaskVersionConflict` was raised
  as an `APIException`; `TaskCommandConflict` was returned as a bare
  `Response`. Unified on raising — added `TaskCommandConflictResponse`
  mirroring `TaskVersionConflictResponse`'s pattern (JSON-native `code`/
  `detail`/extra fields, not DRF's default `ErrorDetail`-string mangling)
  and both command views now `raise` it instead of `return`ing a
  hand-built `Response`. The malformed-`If-Match` 400 also gained a `code`
  key: replaced the bare `ParseError` with a `TaskVersionMalformed`
  `APIException` carrying `{"code": "task_version_malformed", "detail":
  ...}`, matching every other error this feature defines. Covered by an
  assertion added to `test_update_requires_one_quoted_if_match_version`.

Frontend (all resolved 2026-08-06 except the head-of-line-blocking note):

- A `409` response's server-supplied current version — the exact
  information a client needs to recover from a conflict — was discarded at
  the repository boundary (`TaskVersionConflictError` took no arguments).
  The store routed it into the same generic sync-error banner as a dropped
  connection. Fixed: `TaskVersionConflictError` now carries `code` and
  `currentVersions`, `guardTaskMutation` parses the 409 body instead of
  discarding it, and the store shows a distinct "A task changed elsewhere.
  Refreshing to show the latest…" message instead of the generic
  connectivity-trouble banner when the failure is a genuine version
  conflict. Still triggers the same resync either way — that recovery
  action was already correct, only the message was misleading.
- The mutation queue is one global chain across the whole app, not scoped
  per task — this remains true and is an accepted tradeoff for now (see
  below), but the specific bug this caused is fixed: the fence that
  silently dropped every mutation already queued behind a failure is gone.
  `enqueueMutation` no longer captures an epoch and skips stale-epoch work;
  each queued mutation gets its own attempt regardless of an earlier,
  unrelated one's outcome, and `handleSyncFailure()` is fire-and-forget
  from the queue's perspective so the next queued item doesn't wait for the
  resync itself to finish. `mutationEpochRef` (now unused) was removed.
  Head-of-line blocking within a single failure's resolution window is
  still real and still an emergent property of the shared promise chain,
  not yet a deliberate documented choice — left open, lower priority than
  the silent-drop bug it was tangled up with.
- The BFF's own synthetic 409 (`If-Match` header and body `version`
  disagree — a client bug, not staleness) is still mapped to the same
  `TaskVersionConflictError` as a real backend conflict — this specific
  overload was not addressed, since disambiguating it meaningfully would
  need its own error code passed through, which is more scope than this
  pass covered. Noted as a remaining sharp edge, not resolved.
- The two new command routes accepted the request body as untyped and
  unvalidated, and hardcoded their success status/shape instead of echoing
  Django's. Fixed: both routes now validate required-field shape before
  forwarding to Django (a malformed body gets a clean 400 with no Django
  call, matching the PUT route's precondition-validation posture), and
  `requestNestTask`/`requestPromoteSubtask` now return the real response
  status, which the routes echo instead of hardcoding 200/201. Error
  passthrough (status and body, including 409) was already correct and is
  unchanged.
- The fractional-order calculation for a promoted task was duplicated in
  three frontend locations (`repository.ts`, `test-utils.tsx`, `store.tsx`)
  plus the Django service. Fixed: extracted to a single
  `promotedSubtaskOrder()` helper in `lib/reorder.ts`, used by all three —
  this also happened to be where the build-breaking TS narrowing bug lived
  (see Verification checkpoint above), so centralizing fixed both at once.

## Final review round (2026-08-06)

A final review of the fix commits above found one Important regression the
fixes themselves introduced, plus two accepted, documented limitations in
the mutation-queue rewrite:

- **The `TaskVersionConflictError.code` field the 409-wiring fix added was
  never read — resolved.** `store.tsx` discriminated only on
  `instanceof TaskVersionConflictError`, so every command conflict —
  including domain-rule rejections like `same_task` or
  `source_has_subtasks`, which are not a staleness conflict — showed "A
  task changed elsewhere," a new incorrect claim the pre-fix generic banner
  didn't make. Fixed: the check is now `error.code ===
  "task_version_conflict"`, so only a genuine backend staleness conflict
  gets the conflict-specific message; domain-rule rejections fall back to
  the generic sync-error message. Covered by a new test asserting a
  `same_task`-coded conflict does not show "changed elsewhere."
- **Coalescing is now timing-dependent rather than structurally guaranteed
  — accepted, not fixed.** Before the mutation-queue fix, exactly one
  resync per outage was guaranteed because the queue waited for the full
  failure-handling (including the resync) before moving on. Now, if a
  third-or-later queued mutation fails *after* an earlier resync's
  `.finally()` has already fired, a second full resync starts — for the
  API repository, re-running the entire legacy-localStorage upload loop.
  This needs ≥3 queued failures with specific timing to trigger, and the
  worst case is a redundant resync, not incorrect data. Not fixed in this
  pass; worth a note if `resyncingRef` is ever refactored, since the
  guarantee it currently provides is weaker than it looks.
- **A narrow new stale-payload window exists for the 3rd+ queued mutation
  — accepted, not fixed.** Because the queue no longer awaits the resync,
  a mutation third-or-later in the queue can start after
  `replaceLoadedTasks` has refreshed `authoritativeVersionsRef`, so it
  sends a payload captured before the failure together with a
  freshly-refreshed version — passing `If-Match` and overwriting a remote
  change the resync just pulled in. (The first two queued mutations are
  safe: they read their version synchronously, before `repo.list()` can
  resolve, so they 409 instead of overwriting.) Needs ≥3 queued mutations
  plus a concurrent remote edit to the same task to trigger — strictly
  less harmful than the silent-drop bug this fix replaced, so left open
  rather than adding more queue complexity in the same pass.

**Superseded below:** the next independent review showed this was a
data-integrity defect, not an acceptable limitation. A target or parent edit
queued directly behind a failed command could persist that command's optimistic
partial state, so the impact was broader than the 3rd+ mutation case described
at this historical checkpoint.

Also cleaned up, unrelated to RF-005 but touched by the same review:
`FirstFailureThrottleMixin` (RF-018) now calls `self.throttled()` instead
of raising `exceptions.Throttled` directly, and dropped a dead
list-reduction step left over from before the mixin's `break` made it
impossible for more than one throttle to ever contribute a duration. See
[RF-009's resolution](2026-08-06-authentication-hardening.md) for that and
the registration-race fix from the same round.

## Independent-review follow-up: safe queue reconciliation (2026-08-06)

The follow-up reproduced two partial-commit paths: a failed Nest followed by a
target edit could save the optimistic subtask while leaving the source Task in
place, and a failed Promote followed by a parent edit could remove the original
subtask without creating its replacement Task.

The root cause was a full Task snapshot captured at enqueue time, a version read
only at execution time, and a failure resync the queue did not await. An old
aggregate snapshot could therefore be sent with a newly fetched valid version.

The store now keeps authoritative Task snapshots separately from optimistic UI
state. Generic edits record field deltas and ID-based subtask upserts/removals.
After a failure, the queue completes its resync before continuing and rebases
each remaining intent onto the refreshed authoritative Task. An edit requiring
an optimistic entity that disappeared during reconciliation becomes a no-op;
unrelated user intent is preserved. A pre-resync full payload is never paired
with a post-resync version.

Browser task list/write/command requests also abort after 15 seconds. The queue
is still global, so unrelated work can wait behind a slow request, but that wait
is bounded in the production browser repository rather than indefinite.

The same review found that completion history was user-visible but absent from
both Nest loss checks. `completedAt` / `completed_at` now requires the same
explicit confirmation as every other Task-only field.

Regression coverage proves failed Nest/Promote state cannot leak through a
later edit, reconciliation finishes before the next write, hung requests abort,
and completion history is reported as lossy. Verification at this checkpoint:

- frontend RF-005 selection: 100/100 passing;
- frontend TypeScript: clean;
- backend `TaskCommandApiTests` on SQLite: 21/21 passing.

The Oracle attempt could not create a test schema because the local database
user lacks test-schema privileges (`ORA-01031`). This is not an Oracle pass;
RF-012 remains open.

## Post-merge review round: undo, excludedDates, and queue resilience (2026-08-06)

A post-merge audit of the reconciliation redesign confirmed its core claim by
tracing the code directly (a pre-resync payload genuinely cannot pair with a
post-resync version — no mutation path was missed), then found four issues in
the surrounding surface, all fixed:

- **Undoing a promotion of a done subtask silently stopped working.** Adding
  `completedAt` to the lossy-field set (the fix in the section above) closed a
  real gap, but `onUndoPromoteSubtask` still called `convertTaskToSubtask` with
  no third argument, defaulting `confirmDataLoss` to `false` — so undoing a
  promoted, already-done subtask now hit `data_loss_confirmation_required` and
  failed with the generic sync-error banner instead of undoing. Fixed by
  passing `confirmDataLoss: true` specifically for the undo path: undo is a
  single click meant to be instant, not a second place to show the same
  confirmation dialog a regular nest gets, and the only field this can lose
  that a regular nest couldn't is `completedAt` — a value the promotion itself
  synthesized moments earlier, not something the user risks losing by
  surprise. `taskItemHandlers`'s `convertTaskToSubtask` type had also never
  declared the third parameter it was already receiving from callers.
- **`excludedDates` rebased as a full-array overwrite, not a merge.**
  `detachFromRoutine`, `rescheduleTaskToDay`, and `removeTask` all append one
  date to an anchor's `excludedDates` from the optimistic snapshot at enqueue
  time. Because the delta mechanism recorded the *whole resulting array* as
  the patch value (unlike subtasks, which get ID-based upsert/remove deltas),
  rebasing that patch onto a resynced anchor overwrote its `excludedDates`
  entirely — silently dropping a concurrent exclusion pulled in by the same
  resync and letting the next materialization pass resurrect that other
  writer's detached/deleted occurrence. Fixed by giving `excludedDates` the
  same shape of treatment subtasks already have: `buildTaskPatch` records only
  the *added* dates (the set difference from before to after), and
  `applyTaskPatch` unions them onto whatever the rebased base's
  `excludedDates` already holds instead of replacing it.
- **The mutation queue had no tail `.catch`.** Every step already has its own
  try/catch, but if something in the failure-handling path itself threw
  synchronously instead of rejecting (a broken repository implementation, not
  an ordinary network error), the queue's own promise chain would reject
  permanently — silently dropping every mutation enqueued for the rest of the
  session, with no banner and no error. One line of insurance closes it:
  `.catch(() => {})` appended to the chain.
- **No test pinned the "vanished during reconciliation → no-op" behavior** —
  one of four properties the reconciliation section above claims. Added.

Regression coverage: a new `taskItemHandlers` test asserts undo passes
`confirmDataLoss: true`; a new store test drives a real failure + concurrent
write + resync and asserts the rebased anchor's `excludedDates` contains both
the concurrent addition and the locally queued one; a new store test asserts
a queued edit for a task that disappeared during reconciliation calls
`repo.update()` zero times rather than resurrecting it; a new store test
forces `repo.list()` to throw synchronously during a resync and asserts a
later, unrelated mutation still reaches `repo.update()` afterward (verified to
actually fail — with an unhandled rejection — before the `.catch()` fix, to
confirm the test catches the regression it targets, not just passes
trivially).

Verification at this checkpoint: frontend full suite 767/767 passing (4 new),
TypeScript clean, lint clean (no new warnings beyond the pre-existing
RF-016-tracked set).

## Second slice: Detach, Delete-occurrence, and Reschedule (2026-08-06)

Built on the same foundation as Nest/Promote — versioned rows, the owner-row
lock, and `_lock_user`/`_locked_owned_tasks`/`_assert_versions` — three more
command families moved off generic client-composed CRUD, backend and frontend
both:

- **Detach** (`services.py`'s `detach_task`, `POST
  /api/tasks/{id}/commands/detach/`): see the "Detach command" section above.
- **Delete-occurrence** (`delete_occurrence`, `POST
  /api/tasks/{id}/commands/delete-occurrence/`): see "Delete-occurrence
  command" above.
- **Reschedule** (`reschedule_task`, `POST
  /api/tasks/{id}/commands/reschedule/`): see "Reschedule command" above.

All three share one new backend helper, `_current_effective_date(task)`,
which resolves a task's "current day" as `scope_value` for a day-scoped task
or `rolled_from_value` for a week-scoped task rolled over from a day, and
`None` otherwise — the single definition of "current day" every one of these
commands and the frontend's mirrored logic now agree on. They also share
`_append_anchor_exclusion(user, occurrence)`, the additive-union anchor write
described under "Detach command" above.

On the frontend, `detachFromRoutine`, `removeTask`, and `rescheduleTaskToDay`
in `store.tsx` were each rewritten from a pair of generic `persistUpdate`
calls (one for the occurrence/task, one for the anchor — two independent,
non-atomic writes) to a single call into the matching repository command,
following the same `<verb>Task`/`<Verb>Command`/`<Verb>Result` shape Nest and
Promote established (`detachTask`/`DetachTaskCommand`/`DetachTaskResult`,
`deleteOccurrence`/`DeleteOccurrenceCommand`/`DeleteOccurrenceResult`,
`rescheduleTask`/`RescheduleTaskCommand`/`RescheduleTaskResult`) across
`repository.ts`, `api-task-repository.ts`, `api/tasks.ts`, three new BFF
route files, `test-utils.tsx`, and `store.tsx`. Each of the three store
actions still applies an optimistic local update — including the anchor's
`excludedDates`, using the same day-scope-or-rolled-week-scope rule as the
backend's `_current_effective_date` — before the command resolves, then
reconciles both the primary task/occurrence and the anchor against the
command's authoritative response, using the same mutation-generation
reconciliation Nest/Promote already established for a mutation racing a
resync.

Verification at this checkpoint:

- backend `apps.tasks` full suite on SQLite: 103/103 passing (up from the
  94 that predate this slice);
- frontend full suite: 780/780 passing across 53 files;
- frontend TypeScript (`tsc --noEmit`): clean;
- frontend lint (`next lint`): no new warnings beyond the pre-existing
  `store.tsx` `react-hooks/exhaustive-deps` warning tracked since the first
  slice.

Oracle row-lock contention is still unverified for these three commands, for
the same reason noted in the first slice's checkpoint above: SQLite accepts
`select_for_update()` but treats it as a no-op. This remains connected to
RF-012.

## Remaining RF-005 work

RF-005 stays **In progress** until the following client-owned mutation moves to
an equivalent server command and its callers stop composing generic writes:

- **Reorder:** send structural intent such as neighboring Task IDs and let the
  server validate list membership and calculate the fractional order. Sending
  an arbitrary client-computed float would leave the business rule client
  owned. The promotion calculation is already centralized in one frontend
  helper plus the authoritative Django service; a reorder command would remove
  the remaining client authority and close the promotion sibling-locking gap,
  since `POST /api/tasks/` would no longer accept a client-supplied `order`.

The older detach design said detaching did not touch the anchor. That statement
is superseded by the current exclusion behavior: without recording the
original date, a detached or deleted occurrence can be recreated on the next
client materialization pass.

Command idempotency after an ambiguous network timeout is not implemented in
this slice. The version and UUID checks prevent silent overwrite or duplicate
creation, but a committed command whose response is lost may surface as a
conflict on manual retry and require a resync.

## Related follow-up

RF-017 tracks a separate but adjacent race: routine materialization and
rollover still run in the browser. Two sessions can independently observe that
an occurrence is absent and create different UUIDs for the same anchor and
date. The final design needs a server-owned, idempotent day-boundary operation
and a database uniqueness invariant that is portable to Oracle.
