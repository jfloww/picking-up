# Refinement Resolution: Task Cross-Field Domain Validation

- Date: 2026-08-06
- Issue: RF-006 (round 2 — remaining scope)

**Result:** Resolved for the ten cross-field/bucket/rolled-from/repeat/
time-date/uniqueness/bounded-collection rules described in the RF-006 row.
Two are also enforced as portable `CheckConstraint`s; the rest stay
serializer-only for reasons explained below. Two explicit judgment calls were
made where the evidence was legal-but-unreachable rather than a hard rule —
both flagged for the owner to revisit if they disagree. One frontend-comment-
adjacent rule (`time` restricted to `scope_kind == "day"`) was deliberately
left unenforced per the task's own instruction, since the evidence for it is
ambiguous.

This is round 2 of RF-006. Round 1 (subtask id/title truncation, migration
`0014`) is already resolved and untouched here — see `SubtaskSerializer` in
`apps/tasks/serializers.py` and the RF-006 row history.

## Scope

All ten rules below are implemented as cross-field validation on
`TaskSerializer` (`apps/tasks/serializers.py`), following the ground truth
derived from the frontend's authoritative field-meaning comments
(`frontend/src/features/tasks/types.ts`) and the wire-mapping logic
(`frontend/src/features/tasks/api/mapping.ts`). Frontend files were read only
as evidence; nothing outside `backend/apps/tasks/` and its docs was touched.

### 1. `scope_value` format must match `scope_kind`

`day`/`week` require `YYYY-MM-DD`; `month` requires `YYYY-MM`; `year`
requires `YYYY`; `bucket` requires `""` (mapping.ts's `scopeValueOf` never
puts real data on the wire for bucket scope). Enforced with per-kind regexes
in `TaskSerializer.validate()`. Format-only (not calendar-valid-date
checking) — matches how the rule was specified and keeps it a plain regex.

### 2. `bucket_category` ↔ `scope_kind` pairing

`scope_kind == "bucket"` requires `bucket_category` set; every other kind
requires it null. Evidenced directly by mapping.ts's
`bucket_category: task.scope.kind === "bucket" ? task.scope.categoryId : null`.
**Also a `CheckConstraint`** — see "Database-level enforcement" below.

### 3. `rolled_from_kind`/`rolled_from_value` pairing

Both null or both set; when set, `rolled_from_value` must match the same
per-kind format as rule 1. `rolled_from_kind == "bucket"` is rejected
outright.

**Judgment call:** mapping.ts's `scopeFromParts` has an explicit comment that
`rolled_from_kind == "bucket"` is type-legal but "nothing in this app ever
rolls a bucket-scoped task over" — treated here as an invalid domain state
rather than a merely-unreachable one, so the API now rejects it rather than
silently accepting a shape the rest of the app is documented to never
produce. **If the owner disagrees and wants this shape accepted (e.g. for
forward-compatibility with a future bucket-rollover feature), this specific
branch in `validate()` is the one to remove** — it's isolated to a few lines
and doesn't affect the format/pairing checks around it.

### 4. `repeat_weekdays` / `repeat_source` mutual exclusivity

A task cannot have both set. `services.py`'s `nest_task` already assumes
this holds (`if source.repeat_weekdays or source.repeat_source_id`); this
change is what actually enforces it at the API boundary instead of merely
assuming it. **Also a `CheckConstraint`** — see below.

### 5. `repeat_weekdays` bounded/well-formed

Per-item 0-6 bounds were already enforced by the existing
`IntegerField(min_value=0, max_value=6)`. Added: non-empty when present (an
empty list repeats on no day, which is meaningless — treated the same as
"not repeating," i.e. `null`) and no duplicate weekdays.

### 6. `excluded_dates` requires an anchor

Non-empty `excluded_dates` requires `repeat_weekdays` to also be set (per
the type comment: "set only on the anchor task"). Each entry must be
`YYYY-MM-DD`; no duplicates.

### 7. `due_date` excluded for routine-managed tasks

`due_date` must be null whenever `repeat_weekdays` is set (anchor) or
`repeat_source` is set (occurrence) — per the type comment "unset for
routine tasks." Format is `YYYY-MM-DD` when present.

This rule found and fixed a **pre-existing test conflict**: the round-trip
test `test_create_round_trips_every_field_including_subtasks_and_repeat_source`
set both `due_date` and `repeat_source` (and separately, `excluded_dates`
without `repeat_weekdays`) on the same occurrence payload purely to exercise
every field in one request — a combination this rule now correctly rejects.
Split into the anchor carrying `excluded_dates`, the occurrence carrying
`repeat_source` without `due_date`, and a third plain task proving `due_date`
still round-trips on a non-routine task. Two more tests
(`test_nest_detects_data_loss_for_every_lossy_field_individually`'s
`excluded_dates` case, and
`test_promote_rejects_stale_parent_duplicate_child_and_new_id_collision`'s
duplicate-subtask-id case) constructed data that the new rules now reject at
the API boundary; both are legitimate legacy/pre-validation states that
`services.py` still has explicit handling for (`_nest_data_loss_fields`'s
`excluded_dates` entry, `promote_subtask`'s `len(matches) > 1` guard), so
both were rewritten to write that state directly against the DB — the same
pattern this suite already uses elsewhere for legacy data — instead of being
deleted, keeping that service-layer defensive code covered.

### 8. `duration_minutes` requires `time`

`duration_minutes` set requires `time` also set (per the type comment
"meaningful alongside `time`"). `time`'s own format (`HH:MM`, 24h,
zero-padded) is validated as a straightforward regex, unconditionally.

**Deliberately left unenforced:** a rule restricting `time` to
`scope_kind == "day"` only. The task's own instructions flagged the evidence
for this as ambiguous and asked that it not be added without clear evidence
either way. A quick check while in this area
(`frontend/src/features/tasks/lib/reorder.ts`'s day-scoped ordering helpers
branch on `t.time`/`parent.time` only inside `scope.kind === "day"` code
paths) is consistent with `time` being *used* mainly on day-scoped tasks in
the current UI, but that's an artifact of the UI never offering a time input
outside the daily view — it isn't evidence that the backend must reject
`time` on a week/month/year/bucket task, and no rejection or normalization
of that combination was found anywhere in the reviewed frontend or backend
code. Left unenforced as instructed; flagging here in case the owner has
context that resolves the ambiguity.

### 9. Subtask id uniqueness within a task

A `subtasks` array with two entries sharing an `id` is now rejected on
create/update. Previously only `nest_task`'s command path checked this, for
the single subtask it was adding — the generic Task create/PUT path never
checked the whole incoming array.

### 10. Bounded-collection defensive caps

`subtasks` and `excluded_dates` previously had no cap (`JSONField` can grow
unboundedly). Added `SUBTASKS_MAX_COUNT = 200` and
`EXCLUDED_DATES_MAX_COUNT = 200` in `apps/tasks/serializers.py`, next to the
existing `SUBTASK_ID_MAX_LENGTH`/`SUBTASK_TITLE_MAX_LENGTH` constants.

**Judgment call:** there is no product requirement anywhere in the codebase
or frontend for a specific number on either collection. 200 was picked as
generous — an order of magnitude past any realistic real task's subtask or
excluded-date count — purely as an operational/defensive bound against a
client bug or a misbehaving caller growing a single row's JSON payload
without limit, not a derived product rule. Kept as module constants
specifically so they're easy to find and retune later if the owner wants a
different number.

## Database-level enforcement

Two of the ten rules are also enforced as `Task.Meta.constraints`
`CheckConstraint`s (migration `0015_add_domain_check_constraints.py`), using
Django's `Q`-based constraint API for portability across
SQLite/PostgreSQL/Oracle — the same reasoning already used for `Category`'s
`UniqueConstraint`:

- **Rule 2** (`bucket_category_set_iff_scope_kind_is_bucket`): a simple
  `scope_kind == "bucket" <=> bucket_category IS NOT NULL` pairing check.
- **Rule 4** (`repeat_weekdays_and_repeat_source_are_mutually_exclusive`):
  `NOT (repeat_weekdays IS NOT NULL AND repeat_source_id IS NOT NULL)`.

These two were chosen because they're simple null/non-null column
relationships expressible in one `Q` expression, matching the "simple ones
like rule 2 or rule 4" guidance. The remaining eight rules stayed
serializer-only:

- **Rules 1, 3, 6 (format parts), 7 (format part)**: per-`scope_kind` date
  regexes aren't practical as a portable `CHECK` — SQLite has no native
  regex operator, and matching the same expression identically across
  SQLite/PostgreSQL/Oracle dialects isn't worth the complexity for a rule
  the serializer already fully covers.
- **Rule 3's bucket-rejection branch**: a three-way conditional
  (kind/value pairing + format + the bucket special case) is easier to keep
  correct and readable as Python than as a single `Q` expression, and it's a
  judgment call the owner might reverse — better to keep it in one place.
- **Rules 5, 6 (list shape), 9, 10**: these reach into `JSONField` list
  contents (non-empty, uniqueness, per-item format, count) — not expressible
  as a portable Django `CheckConstraint` at all.
- **Rule 8**: cross-references `duration_minutes` and `time`, both plain
  columns, so it's *possible* as a `CheckConstraint`
  (`duration_minutes IS NULL OR time IS NOT NULL`) — left serializer-only
  anyway since it's already fully covered there and the marginal
  defense-in-depth value was judged not worth a fourth migration
  operation for this round. Worth revisiting alongside rule 2/4 if the
  owner wants full parity.

### Migration safety

`0015_add_domain_check_constraints.py` is a straightforward
`AddConstraint`-only migration — no new column, no data backfill. Unlike the
`0009`/`0010`-`0012` multi-step splits (which existed specifically to keep a
fallible data backfill on Oracle's `can_rollback_ddl=False` autocommit
boundary separate from schema changes), there's no data step here for a
partial Oracle DDL failure to leave half-applied, so the single-file,
single-step form is safe as-is.

Before writing the migration, the local SQLite dev database
(`backend/db.sqlite3`) was checked directly for rows that would violate
either constraint:

```text
bucket_category violations: 0
repeat mutual-exclusion violations: 0
total tasks: 0
```

The dev database had zero `Task` rows at the time, so this doesn't prove
much beyond "no known violation exists locally." **This has not been
verified against production Oracle data** — the same open gap tracked by
RF-012 for all Oracle-specific verification in this project. Run the
equivalent check against production before deploying this migration there.

## Verification

```text
DJANGO_SECRET_KEY=... DJANGO_DEBUG=True DATABASE_URL= ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= \
  python manage.py test apps.tasks --verbosity 1
```

(env overrides match `.github/workflows/ci.yml`'s backend job, forcing the
SQLite backend the same way CI does — the default `.env` points at Oracle,
which this sandbox has no credentials for.)

```text
System check identified no issues
No migration changes detected
Found <N> tests
Ran <N> tests
OK
```

New coverage: 20 rules × (accept + reject) plus a handful of extra reject
cases for rules with more than one failure mode (rule 2's two mismatch
directions, rule 5's non-empty vs. uniqueness, rule 8's malformed-`time`
variants, rule 10's subtasks vs. excluded_dates caps), plus one test proving
`validate()` correctly merges a partial PATCH against the current instance
rather than only checking the fields the PATCH happened to send — all in a
new `TaskDomainValidationTests` class in `apps/tasks/tests.py`. Three
pre-existing tests were adjusted (not removed) where they constructed field
combinations the new rules correctly reject; see rule 7's writeup above for
detail on each.
