# Backend Work Summary: Atomic Task Commands and Domain Validation

- Date: 2026-08-07
- Scope: RF-005 (Phase 1) and RF-006 (round 2)
- Purpose: a personal record of this work for future reference (resume/portfolio) —
  distinct from the engineering resolution docs this links to, which remain
  the authoritative technical record. See those for full detail; this is a
  curated summary of what was built and why it mattered.

## RF-005 Phase 1 — Atomic, versioned occurrence commands

**Problem:** Three routine-task actions (detaching an occurrence from its
repeat schedule, deleting an occurrence, rescheduling a task to a new day)
each required two independent writes — the task itself, and a companion
update to its repeat anchor's exclusion list — issued as separate,
non-atomic HTTP requests from the client. A failure between the two, or a
race with a concurrent command, could leave the anchor unaware an occurrence
had been removed, silently resurrecting deleted or moved tasks on the next
sync.

**What was built:**

- Three new atomic Django REST endpoints (`detach`, `delete-occurrence`,
  `reschedule`), each wrapped in `transaction.atomic()`, extending an
  existing versioned-command pattern (Nest/Promote) already in production.
- Two shared service-layer primitives: `_current_effective_date()` (resolves
  a task's real-world date whether it's day-scoped or a rolled-over
  week-scoped task) and `_append_anchor_exclusion()` (an idempotent,
  set-union write onto the anchor's exclusion list, safe under concurrent
  writers without requiring a client-supplied version token for the
  secondary object).
- A Reschedule command that also closes an order-computation race: the
  destination day's sibling order is now computed under a row lock
  server-side, instead of trusting a client-submitted float.
- Full frontend wiring (React/Next.js): optimistic UI updates with
  generation-based reconciliation against the authoritative server state,
  matching the existing mutation-queue architecture.

**Process:** designed via a written spec and implementation plan, then built
through six independently reviewed implementation tasks (three backend, three
frontend) plus a final whole-branch review. The final review caught and a
follow-up fix wave closed three real gaps the per-task reviews couldn't see:
a factually incorrect comment describing query behavior, a missing test
class (per-command transaction-rollback proofs — the tests that actually
verify the atomicity guarantee this work exists to provide), and missing
integration coverage for the three new API routes.

**Verification:** 171 backend tests, 787 frontend tests, all passing on the
merged tree; no schema migrations required.

Full technical record: [2026-08-06-transactional-task-commands.md](2026-08-06-transactional-task-commands.md).

## RF-006 (round 2) — Cross-field domain validation

**Problem:** The Task API validated individual field shape (types, lengths)
but not domain-level meaning — combinations of fields that are individually
valid but jointly nonsensical could be written to the database: a task
claiming to be both a repeat anchor and a generated occurrence, a
bucket-scoped task with a date value, an excluded-dates list on a task with
no repeat schedule to exclude dates from, and seven other such rules.

**What was built:**

- Ten cross-field validation rules on `TaskSerializer`, each derived from
  evidence already present in the codebase (frontend type comments, wire
  mapping logic) rather than invented — with two explicit judgment calls
  flagged for owner review, and one rule deliberately left unenforced where
  the evidence was genuinely ambiguous, rather than guessed.
- Two of the ten rules also promoted to database-level `CheckConstraint`s
  (portable across SQLite/PostgreSQL/Oracle) as defense-in-depth below the
  serializer layer, following a decision framework for which invariants
  justify the extra migration versus which are better kept in
  application code.
- A companion migration, with an explicit pre-migration audit for existing
  rows that would violate the new constraints before applying them.

**Verification:** 117 new/adjusted tests (accept + reject case per rule),
full backend suite green.

Full technical record: [2026-08-06-domain-validation.md](2026-08-06-domain-validation.md).

## Why these matter as a pair

Both pieces of work are instances of the same underlying discipline: finding
places where the system's implicit assumptions ("the client will always send
both writes," "this field combination will never happen") were not actually
enforced anywhere, and replacing the assumption with a guarantee — either an
atomic transaction or an explicit validation rule — while being honest in
the accompanying documentation about what was verified, what was a judgment
call, and what was deliberately left open.
