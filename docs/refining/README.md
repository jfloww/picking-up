# Engineering Refinement Register

This directory is the current source of truth for engineering issues found in
dated project reviews, most recently the 2026-08-12 project/mobile/accessibility
review. Historical specs and plans remain useful records, but their checkboxes
are not a reliable statement of the current implementation state.

## Status definitions

- **Open**: confirmed against the current code and not yet addressed.
- **In progress**: implementation or documentation work has started.
- **Blocked**: requires an owner decision or external access.
- **Deferred**: intentionally postponed by an explicit owner/product decision.
- **Resolved**: implemented and verified; the resolution record is linked.
- **Rejected**: measured or inspected and found not to be a real issue.

## Priority definitions

- **P0**: security, data-integrity, or portfolio-first-impression issue that
  should be handled before adding product features.
- **P1**: important reliability, accessibility, or operational-quality
  improvement.
- **P2**: product polish, scalability, or maintainability improvement that
  should follow proven need and measurement.

## Owner decisions needed

Two active items in this register require direct repository-owner input:

- **RF-001's remaining piece — an owner-approved root README rewrite.**
  The engineering-accuracy half of RF-001 (architecture.md matching the
  actual codebase) is done. The root README is a first-impression,
  narrative document — what to feature, whether to include a screenshot,
  how much detail to show a stranger — and that's an editorial call, not
  something to infer from the code.
- **RF-025 — the installed PWA entry point.** Decide whether launch should open
  the marketing home or `/planner`, including the signed-out return-path
  behavior.

RF-024 is not awaiting a decision: on 2026-08-12 the owner explicitly deferred
Bucket List work until a later product pass.

The register below is authoritative for status. A resolved row records a
completed slice; it does not imply that neighboring issues are resolved.

## Issue register

| ID | Priority | Status | Issue | Evidence / acceptance criteria |
|---|---:|---|---|---|
| RF-001 | P0 | In progress | Core documentation does not fully describe the current system. | The first pass corrected localStorage and `/app` claims. The 2026-08-12 review then found stale Oracle/OCI production topology and incomplete RF-005 command ownership in `architecture.md`; both were corrected to the current Vercel/Cloud Run/Neon deployment and transactional command set. The owner-approved root README rewrite remains open. |
| RF-002 | P0 | Resolved | Backend roadmap contains completed or disproven work as open items. | Timestamp migration and Google token verification are complete. The claimed FK serialization N+1 is rejected because DRF uses PK-only optimization. See [first-pass resolution](2026-08-06-first-pass.md). |
| RF-003 | P0 | Resolved | Category BFF requests do not refresh an expired access token. | `/api/categories` is now covered by middleware refresh behavior and a regression test. See [first-pass resolution](2026-08-06-first-pass.md). |
| RF-004 | P0 | Resolved | Login `next` query parameter is used without validation. | Both password and Google login now accept only normalized same-origin absolute paths. See [first-pass resolution](2026-08-06-first-pass.md). |
| RF-005 | P0 | Resolved | Task domain mutations are client-owned and non-atomic. | Versioned, transactional nest and promotion commands are implemented. An independent review rejected the earlier decision to accept the mutation queue's stale-payload window: failed optimistic commands could leak partial state through a later generic PUT. The queue now waits for reconciliation, rebases field/subtask deltas onto authoritative server state, and bounds browser task requests with a timeout. Completed-task nesting also requires confirmation for discarded completion history. A post-merge round then found and fixed four issues in that same surface: undo-promote silently broken for done subtasks, `excludedDates` rebasing as an overwrite instead of a union (could resurrect a concurrently-detached occurrence), a missing tail `.catch` on the mutation queue (a synchronous throw in the failure path could permanently kill it), and an unpinned no-op behavior for a vanished entity. Detach, occurrence-delete, and reschedule are transactional, versioned commands with frontend wiring complete. Phase 2 closes the last two gaps: Task creation's `order` is now computed server-side (the generic `POST /api/tasks/` no longer accepts a client-supplied value), and a Reorder command (`POST /api/tasks/{id}/commands/reorder/`) replaces the client-computed drag-to-reorder float with server-validated neighbor IDs and a server-calculated fractional order; the frontend's `setOrder` store action is removed. See the [progress record](2026-08-06-transactional-task-commands.md). |
| RF-006 | P0 | Resolved | Task API validates field shape but not domain meaning. | Round 1: subtask IDs/titles share the 255/500-character command/storage limits, truncated rather than rejected on write (a hard reject would permanently block editing any task carrying a legacy over-length subtask, since the generic PUT always resends the whole subtasks array); migration 0014 truncates existing DB rows once. Promote rejects an invalid legacy title as a domain conflict instead of a production-DB 500, and now strips before both the length check and storage instead of only the check. Round 2 closes the remaining scope: `TaskSerializer.validate()` now enforces all ten cross-field/bucket/rolled-from/repeat/time-date/uniqueness/bounded-collection rules derived from the frontend's authoritative type comments and wire mapping, and migration 0015 adds two portable `CheckConstraint`s (bucket_category/scope_kind pairing, repeat_weekdays/repeat_source mutual exclusivity) as defense-in-depth below the serializer; the other eight rules stay serializer-only (JSONField-contents or per-kind-regex rules aren't expressible as a portable CHECK). Two judgment calls were made — rejecting `rolled_from_kind == "bucket"` as an invalid domain state, and picking generous (200-item) defensive caps for `subtasks`/`excluded_dates` with no derived product number — both flagged for the owner to revisit. A `time`-restricted-to-`scope_kind=="day"` rule was deliberately left unenforced; the evidence for it remains ambiguous. See the [round 2 resolution](2026-08-06-domain-validation.md). |
| RF-007 | P0 | Resolved | Case-insensitive category uniqueness has a TOCTOU race. | `(user, normalized_name)` remains the database authority. The category-normalization sequence is 0010 (nullable AddField only), 0011 (transactional merge/backfill), and 0012 (full late-straggler merge plus finalize) — that is RF-007's whole scope; migration numbering continues afterward with unrelated work, not more of this graph: 0013 is Task version (RF-005) and 0014 is the RF-006 legacy-subtask cleanup. The finalize test inserts a late casefold duplicate with a Task FK and proves deterministic merge/repointing. Runtime and migration preflight reject NFKC keys beyond the 180-character storage boundary. SQLite was verified at resolution time; production later moved from Oracle to Neon PostgreSQL, and current production-engine parity is tracked by RF-012. A post-merge audit re-verified the graph directly against Django's executor internals and found it correct; it also fixed `Category.save()`'s model-level guard raising an exception class DRF doesn't translate. The linked record preserves the historical Oracle DDL retry analysis for the legacy fallback stack. See the [resolution](2026-08-06-category-uniqueness.md). |
| RF-008 | P0 | Resolved | A plaintext demo credential was committed in local study history. | The current tree is clean. Detailed commits are preserved only on a local study branch; the published ancestry starts at `origin/main` and excludes the introducing commit. Per owner confirmation (2026-08-06), the credential was never live, reused, or shared outside the local study branch, so no rotation or external purge is required. See the [mitigation and publication record](2026-08-06-credential-removal.md). |
| RF-009 | P1 | Resolved | Authentication failure behavior and abuse controls are incomplete. | Email login delegates to Simple JWT with a dummy-hash email backend; login/register/Google have burst and sustained throttles. Existing-account Google link races now reuse the database winner instead of returning 500. Auth BFF routes preserve Django status and `Retry-After`. A post-merge audit re-verified the Google-link-race fix against Django's actual transaction/constraint behavior and confirmed it holds; it also found and fixed `RegisterSerializer` mislabeling a username collision as an email collision (username is an exposed, independently-unique field with no prior pre-check), including a savepoint fix for a `TransactionManagementError` the first version of that fix introduced on the concurrent path. Distributed throttle storage and a unified error envelope remain separate operational follow-ups. See the [resolution](2026-08-06-authentication-hardening.md). |
| RF-010 | P1 | Open | Concurrent refresh-token rotation can invalidate sibling requests. | Reconfirmed 2026-08-12: centralize refresh behavior and add a single-flight/concurrency strategy. Add a test for simultaneous expired authenticated requests. |
| RF-011 | P1 | Resolved | No continuous integration exists. | GitHub Actions now runs backend checks/tests and frontend tests/lint/build on pull requests and pushes to `main`. See [first-pass resolution](2026-08-06-first-pass.md). |
| RF-012 | P1 | Open | Production PostgreSQL behavior is not continuously tested. | Production moved to Neon PostgreSQL, superseding the earlier Oracle test-schema criterion. Run a repeatable PostgreSQL integration job in CI, cover migrations/constraints against that engine, and record an actual backup/restore or point-in-time-recovery verification. |
| RF-013 | P1 | Open | Production operations are documented but not yet fully exercised or observed. | `/api/health/`, request-correlated console logging, and Cloud Run/Vercel rollback guidance now exist. Add dependency-aware readiness, alerting, production security-setting checks, and evidence from a restore and rollback rehearsal. |
| RF-014 | P1 | In progress | API errors have multiple incompatible shapes. | Auth BFF routes now preserve upstream status and `Retry-After` through a shared status-aware error type. Remaining work: define and migrate to a versioned envelope with machine code, human detail, and field errors across every API family. |
| RF-015 | P2 | Open | Query and pagination work is not driven by measured access patterns. | Add domain filters and query-count/explain evidence before indexes or pagination. Do not add `select_related` for the current PK-only serializer without a failing query-count test. |
| RF-016 | P2 | Open | Dependency and build reproducibility need tightening. | Pin/lock Python dependencies, align documented Python versions, migrate from deprecated `next lint`, remove lint warnings, and make clean production builds repeatable in an isolated output directory/process rather than sharing `.next` with a running dev server. |
| RF-017 | P0 | Open | Routine materialization and rollover are client-owned and race-prone. | Reconfirmed 2026-08-12: two sessions can generate different UUID occurrences for the same anchor/date because creation has no server transaction or logical occurrence uniqueness. The acceptance record specifies idempotency, timezone/DST policy, `(user, anchor, local date)` identity, legacy duplicate migration, client cutover, and PostgreSQL/two-session verification. See the [follow-up contract](2026-08-06-routine-materialization-follow-up.md). |
| RF-018 | P0 | Resolved | Auth throttling's burst/sustained interaction plus an unguarded `NUM_PROXIES=0` default combined into a cheap, potentially site-wide login lockout. | Fixed with a `FirstFailureThrottleMixin` that stops evaluating throttles once one has already rejected a request (so a burst rejection no longer also consumes the sustained daily budget), applied to all three throttled views, plus a settings-time guard raising `ImproperlyConfigured` when `not DEBUG and DJANGO_NUM_PROXIES == 0`, mirroring the existing `SECRET_KEY` check. Regression coverage asserts the sustained throttle's recorded history stays at 1 after 5 rapid requests (1 allowed, 4 burst-rejected). A final review round found the mixin bypassed DRF's `throttled()` extension point and carried dead reduction logic — both cleaned up. See [RF-009 resolution, "Gaps found in review" and "Final review round"](2026-08-06-authentication-hardening.md). |
| RF-019 | P2 | Resolved | Two users differing only by email case caused a silent, permanent password-login lockout for both. | `RegisterSerializer.validate_email` now checks `email__iexact`, matching `EmailBackend`'s lookup, so the API can no longer create the ambiguity in the sequential case. The residual admin/shell-created case now logs a warning (after the same dummy `make_password()` cost, so timing is unaffected) instead of failing silently. A final review round found the `__iexact` check alone doesn't close the *concurrent* case (two racers can both pass it before either commits) — `create()` now converts the loser's `IntegrityError` into the same validation error instead of surfacing a 500. Regression tests cover all three paths. See [RF-009 resolution, "Gaps found in review" and "Final review round"](2026-08-06-authentication-hardening.md). |
| RF-020 | P2 | Resolved | Draggable task rows render invalid nested `<li>` elements. | The drag wrapper now owns the list item and asks `TaskItem` for a `<div>` root. Focused TaskItem/WeeklyView coverage asserts no nested list item and keeps reorder behavior passing. See the [resolution](2026-08-06-task-list-semantics.md). |
| RF-021 | P1 | Open | Readable muted text does not consistently meet WCAG AA contrast. | On 2026-08-12, `--subtle` measured about 3.04:1 on the light background, 3.15:1 on a light card, 4.23:1 on the dark background, and 3.93:1 on a dark card, while it is widely used at 10-12 px. Split decorative/readable muted tokens and verify at least 4.5:1 for normal text in both themes. |
| RF-022 | P1 | Open | Reordering lacks an equivalent keyboard operation, and some subtask mobile actions are undersized or hard to discover. | Pointer-only reorder hooks need keyboard-accessible move controls or a supported keyboard sensor. Independent touch actions should be at least 44 x 44 CSS px; promote/delete controls must not depend on hover for mobile discovery. Add keyboard and touch-viewport regression coverage. |
| RF-023 | P2 | Open | Task-detail **Done** fans one logical commit into multiple queued field writes. | Replace per-field persistence on drawer commit with one final-snapshot store/repository update. Preserve optimistic concurrency, reconciliation, dirty-state behavior, and the Enter/Done equivalence tests. |
| RF-024 | P2 | Deferred | Bucket List is implemented but intentionally omitted from desktop and mobile navigation. | Owner decision recorded 2026-08-12: revisit later. Do not treat it as a current defect or release blocker; resume with a deliberate navigation/mobile IA pass. |
| RF-025 | P2 | Blocked | The installed PWA opens the marketing home instead of the planner workspace. | `manifest.ts` currently uses `start_url: "/"`. Owner decides `/` versus `/planner` and the signed-out return path; then add installed-launch coverage for both auth states. |
| RF-026 | P1 | Open | There is no real-browser mobile/accessibility regression gate. | Add Playwright smoke flows for core planner/auth paths at mobile and desktop viewports, axe checks for pages/drawers, keyboard-flow assertions, and stabilize the weekly-view full-suite timing flake observed on 2026-08-12. |
| RF-027 | P2 | Open | Generated design context is stale. | `.superdesign/init/routes.md` still describes `/app` and a Yearly view. Regenerate the context from the current `/planner` route and current Daily/Weekly/Monthly view model before the next design pass. |

## PR verification checkpoint

The complete 2026-08-06 candidate tree was verified locally with:

- `manage.py test --verbosity 1`: 113 tests passed using SQLite;
- `manage.py check`: no issues;
- `manage.py makemigrations --check --dry-run`: no changes detected;
- `npx vitest run --reporter=dot`: 763 tests across 53 files passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: exited successfully with zero errors; existing warnings are
  still tracked by RF-016; and
- `npm run build`: completed successfully after the local Next.js dev server
  holding `.next/trace` was temporarily stopped. The server was restored on
  port 10050 after verification.

`git diff --check` also passed, and a repository-local link check found no
broken relative Markdown targets under `docs/`.

At that checkpoint, the Oracle test attempt was not a pass because the
configured user could not create a test schema (`ORA-01031`). Production has
since moved to Neon PostgreSQL; RF-012 now tracks PostgreSQL CI parity and
restore evidence instead of Oracle test-schema access.

### Remote CI portability follow-up

The first PR run passed Backend but failed nine tests in one frontend route-
integration file. Production code correctly read `DJANGO_API_BASE_URL`; the
test router instead hardcoded `http://localhost:8000`, while CI intentionally
set `http://127.0.0.1:8000`. The router therefore rejected every real BFF-to-
Django request as unexpected and caused nine secondary assertion failures.

The test now derives its Django origin from the same environment variable with
the production fallback. Verification using CI's exact origin passed all 13
tests in that file and then all 763 frontend tests. This was a test-environment
contract defect, not a production request-routing failure.

### Post-merge follow-up verification (2026-08-06)

A five-area post-merge review of the merged PR (auth, migrations, task
commands, frontend queue reconciliation, BFF/docs/RF-020) found zero Critical
issues and confirmed the queue-reconciliation redesign's core safety claim by
tracing the code directly. It found eight Important issues across backend and
frontend, all fixed in a follow-up branch — see the RF-005/006/007/009 rows
above and each area's dated resolution record for detail. Verified after all
eight fixes:

- `manage.py test apps`: 116 tests passed using SQLite;
- `manage.py makemigrations --check --dry-run`: no changes detected;
- `npx vitest run`: 767 tests across 53 files passed;
- `npx tsc --noEmit`: passed; and
- `npm run lint`: zero errors, no new warnings beyond the RF-016-tracked set.

One fix (the `RegisterSerializer` username-collision handling) initially
introduced a `TransactionManagementError` on its own concurrent-race test,
caught by running the new test before considering the fix complete — a
savepoint around the insert, the same pattern `services.py` already uses for
its own insert race, resolved it. Recorded as a reminder that a fix touching
exception handling inside a transaction needs its own race test run, not just
a read-through.

## Recommended execution order

1. Resolve RF-017 so routine occurrence creation has one idempotent server and
   database authority.
2. Address RF-010 and finish RF-014 so authentication concurrency and API
   failure handling have stable contracts.
3. Address RF-021, RF-022, and RF-026 together as the accessibility/mobile
   quality pass: contrast and keyboard/touch behavior backed by browser tests.
4. Close RF-012 and RF-013 before claiming production readiness: PostgreSQL CI
   parity, readiness/alerting, security-setting checks, restore evidence, and a
   rollback rehearsal.
5. Batch drawer commits under RF-023, then tighten dependencies/build tooling
   under RF-016 and refresh generated design context under RF-027.
6. Complete RF-001's owner-approved root README rewrite and decide RF-025's PWA
   launch route. RF-024 stays deferred until the owner resumes Bucket List.

The issue table above is authoritative. An issue remains open or in progress
until its row says otherwise; a dated implementation record does not by itself
mean that every related acceptance criterion has been completed.

## Resolution and progress records

- [2026-08-12 project, mobile, and accessibility review](2026-08-12-project-mobile-accessibility-review.md)
- [2026-08-06 first pass: auth routing and roadmap corrections](2026-08-06-first-pass.md)
- [2026-08-06: database-enforced category uniqueness](2026-08-06-category-uniqueness.md)
- [2026-08-06: authentication consistency and abuse controls](2026-08-06-authentication-hardening.md)
- [2026-08-06 RF-005 progress: transactional nest and promotion commands](2026-08-06-transactional-task-commands.md)
- [2026-08-06 RF-008 mitigation: remove the committed credential from the current tree](2026-08-06-credential-removal.md)
- [2026-08-06 RF-020 resolution: task list semantic ownership](2026-08-06-task-list-semantics.md)
- [2026-08-06 RF-017 follow-up contract: server-owned routine materialization](2026-08-06-routine-materialization-follow-up.md)
- [2026-08-06 RF-006 round 2: Task cross-field domain validation](2026-08-06-domain-validation.md)
