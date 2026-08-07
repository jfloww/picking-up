# Refinement Resolution: Database-Enforced Category Uniqueness

- Date: 2026-08-06
- Issue: RF-007
**Result:** Resolved and verified on the SQLite test backend. An independent
review reopened the migration-safety portion after finding that the first split
still mixed Oracle-autocommitted `AddField` with a fallible data backfill and
that its straggler guard did not merge late duplicates. The migration graph and
deployment procedure are corrected below. Oracle execution remains unverified
under RF-012.

## Problem

Category create and rename previously checked `name__iexact` before writing,
while the database constrained only the exact `(user, name)` pair. Two
concurrent requests could both pass the pre-check and insert differently cased
versions of the same logical category. The API intended case-insensitive reuse,
but the database did not enforce that invariant.

## Solution

### Stable identity key

`Category` now stores a server-owned `normalized_name` key. The key is derived
with Unicode NFKC normalization, whitespace trimming, and `casefold()` rather
than locale-dependent database `LOWER()` behavior.

Examples:

```text
"  To Eat  " -> "to eat"
"Straße"     -> "strasse"
"STRASSE"    -> "strasse"
"Ｔｏ Ｅａｔ" -> "to eat"
```

The model recomputes the key on every save and includes it automatically when a
caller saves `name` with `update_fields`.

NFKC can expand a short display name substantially. The API and model now
reject a normalized key longer than the 180-character storage boundary before
the database write. The migration backfill performs the same preflight and
raises an actionable error before partial merge work; this avoids a SQLite-only
pass becoming an Oracle/PostgreSQL `DataError` or a generic 500.

### Database authority

The old exact-name constraint was replaced with:

```text
UNIQUE (user, normalized_name)
```

The API no longer relies on a check-then-insert sequence. Category creation uses
`get_or_create()` with the normalized identity key; Django's implementation
retries the lookup after a unique-constraint conflict. A competing create
therefore returns the existing category instead of creating a duplicate or
surfacing a 500.

Rename still performs an early validation query for a useful field error, but
the write is wrapped in a transaction and catches the database `IntegrityError`
as the final race-safe boundary.

### Existing data migration

The migration is split at real migration-file boundaries:

1. `0010_category_normalized_name` adds only the nullable key.
2. `0011_category_normalized_name_backfill` runs the deterministic merge in an
   atomic data-only migration: earliest owner/creation/ID row survives, Task
   foreign keys are repointed, and duplicates are deleted.
3. `0012_category_normalized_name_finalize` reruns the complete merge for rows
   written in the cutover window, then makes the key non-null and swaps the
   uniqueness constraint.
4. `0013_task_version` follows the completed category migration.

The migration is intentionally one-way for merged duplicate rows: reversing the
schema cannot recreate categories that represented the same logical identity.

## Deployment note

This schema change is not compatible with old application processes continuing
to create Category rows because old code does not populate `normalized_name`.
Deploy it with category writes paused, or stop gunicorn before `migrate` and
restart it only after the new application code and migration are both present.
Do not describe this migration as zero-downtime without a separate dual-write
expand/contract deployment.

## Migration atomicity on Oracle (found in review, 2026-08-06; resolved 2026-08-06)

Django's `can_rollback_ddl` is `False` on the Oracle backend (only the
PostgreSQL and SQLite backends override it), so migration 0010 ran with
`atomic=False` in production: the `AddField`, every write inside
`backfill_normalized_names`, and the final `AlterField`/constraint swap each
committed independently rather than as one transaction. A failure partway
through — a bad row, a lock timeout, a killed session — would leave the
column added, some rows backfilled, some Task foreign keys repointed, and
some duplicate Category rows deleted, with the migration recorded as
unapplied. Re-running would then fail immediately at `AddField` (`ORA-01430`,
column already exists) and require manual DDL to recover.

This was the same class of problem migration 0009 (`Task.created_at`/
`completed_at`) was specifically hardened against earlier in this project —
0010 did not originally get the equivalent treatment.

**First attempted resolution, rejected in the next review:** 0010 kept
`AddField` and `RunPython` together, so a backfill failure could still leave the
column committed while Django recorded the migration as unapplied. Its 0011
guard only filled `NULL`; a late casefold-equivalent duplicate would then make
UNIQUE creation fail instead of becoming an ordinary API conflict.

**Final resolution:** use three category migration boundaries:

- `0010_category_normalized_name.py` contains only nullable `AddField`.
- `0011_category_normalized_name_backfill.py` contains only the transactional,
  deterministic merge and normalized-length preflight.
- `0012_category_normalized_name_finalize.py` reruns that complete merge — not
  merely a NULL fill — before the non-null and constraint operations. The merge
  is idempotent and wrapped in its own transaction, so it is safe to retry if a
  later Oracle DDL step fails.
- Task version follows as `0013_task_version.py`.

The real file boundary between backfill and finalize makes the race testable:
the migration test stops after 0011, inserts an old-writer casefold duplicate
with `normalized_name = NULL` plus a Task foreign key, advances to 0012, and
asserts one deterministic survivor and a repointed Task.

This graph assumes these branch-only migrations have not been applied to a
shared database. If an environment applied the earlier 0010-0012 graph, do not
pretend it is equivalent by editing rows in `django_migrations`; plan an
explicit repair migration or restore before deploying this branch.

## Verification

Latest focused verification after the independent-review corrections:

```text
No migration changes detected
Found 18 tests
Ran 18 tests
OK
```

The earlier full-backend checkpoint below is retained as historical evidence;
the combined tree receives a new full-suite checkpoint before the PR is opened:

```text
System check identified no issues
No migration changes detected
Found 67 tests
Ran 67 tests
OK
```

Coverage added for:

- NFKC and casefold key generation;
- database rejection of same-owner Unicode/casefold equivalents;
- same display name remaining valid for different owners;
- normalized key maintenance on rename;
- API reuse of an existing Unicode/casefold-equivalent category; and
- migration-time duplicate merging with Task foreign-key repointing.

The full suite still prints pre-existing logging and development-secret
warnings. They do not fail the suite and are tracked separately as operational
and test-output cleanup work.

## Post-merge review round (2026-08-06)

A post-merge audit of the 4-way migration split (after it had already landed
on `main`) found the graph itself correct end-to-end — dependency chain, the
0011/0012 non-redundancy, the 180-char preflight, and the finalize test's Task
FK repoint assertion all held up under direct inspection of Django's executor
internals, not just a re-read of this doc. Two findings, one fixed, one
recorded rather than fixed:

- **`Category.save()`'s 180-char guard raised the wrong exception class to be
  a safety net outside the serializer — fixed.** It raised
  `django.core.exceptions.ValidationError`, which DRF's default exception
  handler does not translate into a clean response; a future code path that
  writes a `Category` without going through `CategorySerializer.validate_name`
  first (a management command, a bulk import) would have surfaced this as an
  unhandled 500 instead of the same clean 400 the serializer already
  guarantees on the two current live paths. Both `CategoryListCreateView.create()`
  and `CategoryDetailView.perform_update()` now also catch
  `django.core.exceptions.ValidationError` and re-raise it as a DRF
  `ValidationError`, matching the existing `IntegrityError` handling in
  `perform_update()`. Covered by two new tests that mock the model/manager
  layer to force this path, since the serializer's identical check makes it
  otherwise unreachable through the live API.
- **Migration 0012's own DDL sequence (`AlterField`/`RemoveConstraint`/`AddConstraint`)
  has the same un-closed Oracle retry hazard 0009 already has — recorded, not
  fixed.** Each of those three operations auto-commits independently on
  Oracle. If `AddConstraint` fails after `AlterField`/`RemoveConstraint`
  already committed, Django records 0012 as unapplied, and a retry replays
  all four operations from the top — `merge_stragglers` is idempotent and
  safe to rerun, but re-running `AlterField` on an already-NOT-NULL column or
  `RemoveConstraint` on an already-removed constraint risks Oracle DDL errors
  requiring manual recovery. This is not new to the 4-way split — `0009`
  (`Task.created_at`/`completed_at`) has the identical multi-step-DDL shape
  and is the pattern this project has otherwise treated as acceptable — so
  this is an inherited, accepted risk class, not a regression. Worth testing
  explicitly (a forced mid-0012 failure-and-retry, not just the happy path)
  whenever RF-012's Oracle verification actually happens, rather than being
  discovered live against production data.
