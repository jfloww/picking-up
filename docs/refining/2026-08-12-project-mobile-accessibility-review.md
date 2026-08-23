# 2026-08-12 project, mobile, and accessibility review

## Scope and disposition

This review covered the current planner interaction model, task-detail commit
flow, mobile controls, keyboard access, design-token contrast, PWA entry point,
test strategy, and the accuracy of architecture/operations documentation.

The repository owner explicitly deferred Bucket List work on 2026-08-12. The
existing implementation remains intentionally hidden from desktop and mobile
navigation; it is recorded as **Deferred**, not as a current defect or release
blocker.

## Findings

| Register item | Finding | Recommended outcome |
|---|---|---|
| RF-017 (existing, P0) | Routine rollover/materialization is still initiated by the browser. Two sessions can create different occurrence UUIDs for one logical anchor/date. | Move occurrence identity and idempotent materialization to one server/database authority before expanding routine features. |
| RF-010 (existing, P1) | Expired authenticated requests can rotate the same refresh token concurrently. | Add single-flight refresh coordination and a simultaneous-request regression test. |
| RF-021 (new, P1) | `--subtle` is used for many 10-12 px labels. Measured contrast is about 3.04:1 on the light background, 3.15:1 on a light card, 4.23:1 on the dark background, and 3.93:1 on a dark card; normal-size WCAG AA text needs 4.5:1. | Split decorative and readable-muted tokens, raise readable text contrast to at least 4.5:1 in both themes, and verify affected planner/drawer/calendar states. |
| RF-022 (new, P1) | Reorder hooks expose pointer handlers without an equivalent keyboard operation. Subtask drag/promote/delete controls are 24 px and action buttons are visually hidden until hover/focus, making discovery and touch use harder. | Provide keyboard-accessible move actions or an accessible drag sensor, keep visible mobile actions, and use at least 44 x 44 CSS-pixel touch targets where controls are independent. |
| RF-023 (new, P2) | Drawer **Done** can translate one user commit into several queued per-field task updates. Queue reconciliation protects consistency, but the flow adds avoidable requests, latency, and conflict opportunities. | Add one store/repository commit operation that persists the final drawer snapshot once, while retaining optimistic concurrency and reconciliation behavior. |
| RF-024 (new, Deferred) | Bucket List components and data paths exist, but desktop and mobile view lists intentionally omit the route/tab. | Do nothing in the current release. Revisit navigation, mobile information architecture, and completion criteria when the owner resumes Bucket List work. |
| RF-025 (new, P2) | The installable PWA starts at `/`, so launching it opens the marketing page rather than the authenticated planner workspace. | Decide the installed-app entry contract, then test signed-in and signed-out launches. Prefer `/planner` if authentication fallback preserves the intended return path. |
| RF-026 (new, P1) | Frontend coverage is Vitest/Testing Library/jsdom only; there is no real-browser mobile or automated accessibility gate. One full-suite run also exposed a weekly-view timing flake that passed in isolation. | Add Playwright smoke paths at mobile and desktop viewports, axe checks for core pages/dialogs, keyboard-flow assertions, and stabilize the weekly-view wait. |
| RF-027 (new, P2) | Generated Superdesign context still describes `/app` and a Yearly view, while the live planner route/view model has changed. | Regenerate the design context from the current application before the next UI redesign so design work starts from the real route and component map. |

## Documentation corrections made in this review

- `docs/architecture.md` now describes Vercel -> Cloud Run -> Neon PostgreSQL
  as the current production topology and treats the OCI/Oracle stack as a
  legacy fallback.
- RF-005's completed detach, occurrence-delete, reschedule, server-order, and
  reorder command work is reflected in the domain and consistency sections.
- RF-012 now tracks repeatable production-PostgreSQL CI plus restore evidence,
  rather than an obsolete Oracle test-schema requirement.
- RF-013 now acknowledges the existing unauthenticated health endpoint,
  request-correlated console logging, and rollback runbook; its remaining scope
  is readiness depth, alerting, production security settings, and rehearsal.
- RF-001 remains in progress because the root README still needs an
  owner-approved rewrite.

## Verification snapshot

The task-detail Enter change associated with this review was checked separately
from the documentation work:

- Task detail drawer: 86 focused tests passed, including Enter committing and
  closing while Enter in the subtask composer still adds a subtask.
- TypeScript: `tsc --noEmit` passed.
- Frontend suite: 881 of 882 tests passed on the combined run; the single
  weekly-view timeout then passed 21 of 21 when run alone and is tracked as a
  flake in RF-026.
- Lint: completed with zero errors; warnings remain under RF-016.
- Django: `manage.py check` and `makemigrations --check --dry-run` passed; the
  15 configuration tests passed.
- A complete backend-suite result and a clean isolated production-build result
  were not obtained in this review window, so this record does not claim either
  as green.
