# Task Timestamp Fields: CharField → DateTimeField

**Date:** 2026-08-06
**Status:** Approved

## Problem

`Task.created_at` and `Task.completed_at` are both `CharField`s storing
client-generated ISO-8601 strings (`backend/apps/tasks/models.py:51-52`),
not real `DateTimeField`s. Both are currently writable via the API —
`TaskSerializer` has no `read_only_fields` at all, and `completed_at` has
an explicit `CharField` override (`serializers.py:33-35`). Consequences:
no DB-level date arithmetic or range queries, no format validation (a
garbage string is a valid value), and a client is trusted to report both
"when this was created" and "when this was completed" truthfully. This is
item #1 on `docs/planning/8. backend-improvements.md`.

`Category.created_at` already does this correctly
(`auto_now_add=True`, `models.py:22`) — that's the reference pattern.

## Goal

Both fields become real `DateTimeField`s, server-authoritative, with
existing data safely migrated — no data loss, no downtime-causing
migration step, no frontend code changes required.

## Scope decisions (brainstormed and approved)

- **Both fields together**, not just `created_at` — `completed_at` has
  the identical root cause (CharField storing a client-generated
  timestamp), found while reading the model for this change.
- **`created_at` becomes `auto_now_add=True`**, fully read-only via the
  API, mirroring `Category.created_at` exactly. No client override path
  — YAGNI; if a historical-data-import feature is ever built that needs
  to set an explicit past `created_at`, that's a separate, later change,
  not speculative scaffolding now.
- **`completed_at` becomes server-derived from the `done` transition**,
  not client-supplied. Set to `timezone.now()` when `done` flips
  False→True, cleared when it flips True→False. This is a real behavior
  change (today the client decides and sends the timestamp), justified
  by the same reasoning as `created_at`: the server should own
  timestamps it can independently derive, not trust a client value for
  them. Mirrors what the frontend's `toggleTask` store action already
  does today, just enforced server-side now instead of only client-side.
- **No frontend changes.** Confirmed by reading `store.tsx`: every
  `repo.create(task)`/`repo.update(task)` call is already fire-and-forget
  (`.catch(handleSyncFailure)`, response body never read back into local
  state), so the frontend already doesn't depend on the server echoing
  back an authoritative value. The one user-visible spot,
  `completed_at`'s "Completed {date}" label in the task detail drawer,
  is driven by the client's own optimistic value and stays accurate to
  within a second or two of the server's — self-correcting on next
  refetch, not a real discrepancy. `created_at` isn't displayed in the
  UI at all today.
- **Parse-failure fallback**: an unparseable or empty existing string
  falls back to `updated_at` (a real, always-populated `DateTimeField`
  already on the model) during backfill, with the affected task IDs
  logged — not a migration-blocking abort, not a silent guess.

## Migration mechanics

Three migration files (schema changes and data migrations kept separate,
matching this repo's existing `0004`/`0005` bucket-category-backfill
precedent) — a bare in-place `AlterField` isn't used because Django
doesn't generate a safe string→datetime data-conversion path for it, and
relying on the database to implicitly cast existing string values during
an `ALTER TABLE ... MODIFY` isn't reliable across backends, notably
Oracle (this app's production database):

1. **Add** nullable shadow columns: `created_at_dt`, `completed_at_dt`
   (both `DateTimeField(null=True, blank=True)` at this stage — nullable
   is required before backfill has run).
2. **Backfill** (`RunPython`, historical model via `apps.get_model`):
   parse each task's existing `created_at`/`completed_at` string to a
   UTC `datetime`, write it to the corresponding shadow column. Falls
   back to `updated_at` on parse failure or an empty string, logging the
   task ID. `completed_at_dt` stays `None` wherever `completed_at` was
   already blank/null.
3. **Finalize**: `RemoveField` the old CharField columns, `RenameField`
   the shadow columns to the final names (`created_at_dt` →
   `created_at`, `completed_at_dt` → `completed_at`), then `AlterField`
   to make `created_at` non-nullable (it should never be null) while
   `completed_at` stays nullable (matches "not all tasks are done").

## Model & serializer changes

`backend/apps/tasks/models.py`:
```python
created_at = models.DateTimeField(auto_now_add=True)
completed_at = models.DateTimeField(null=True, blank=True)
```

`backend/apps/tasks/serializers.py`:
- Delete the explicit `completed_at = serializers.CharField(...)` field
  override — falls back to the auto-generated `DateTimeField` from the
  model.
- Add `read_only_fields = ("created_at", "completed_at")` to
  `TaskSerializer.Meta` (currently absent).
- Extend the existing `TaskSerializer.update()` override (already
  overridden for `id` immutability): if `"done"` is in `validated_data`
  and differs from `instance.done`, set `completed_at` to
  `timezone.now()` on the False→True transition or `None` on the
  True→False transition, before delegating to `super().update()`.

## Testing

- Migration test following the `MigrationExecutor`-based pattern already
  established by `BackfillBucketCategoriesMigrationTests`: migrate to
  just before this change, create rows spanning valid ISO strings,
  garbage strings, and (for `completed_at`) null/blank, migrate forward
  through all three new migrations, assert the final values — correctly
  parsed where valid, correctly fell back to `updated_at` where not.
- API tests: creating a task ignores a client-supplied `created_at`;
  `PATCH`ing `done: true` sets `completed_at` server-side; `PATCH`ing
  `done: false` clears it; explicitly sending `created_at`/`completed_at`
  in a request body is silently dropped, not rejected (standard DRF
  read-only-field behavior).
- Update the existing
  `test_create_round_trips_every_field_including_subtasks_and_repeat_source`
  test — it currently asserts `created_at` round-trips exactly as sent,
  which is no longer true now that the field is server-controlled.

## Non-goals

- No historical-data-import override path for `created_at` (deferred
  until an actual import feature needs it).
- No change to `updated_at`'s existing `auto_now=True` behavior.
- No frontend code changes.
- No change to `Category`'s timestamp handling — already correct, used
  here as the reference pattern.
