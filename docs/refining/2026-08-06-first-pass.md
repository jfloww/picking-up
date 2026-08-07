# Refinement Resolution: Auth Routing and Roadmap Corrections

- Date: 2026-08-06
- Issues: RF-002, RF-003, RF-004, RF-011; partial RF-001
**Result:** Resolved except for the remaining README work under RF-001.

## What changed

### RF-003: category requests now participate in token refresh

The middleware previously refreshed expired access tokens for task BFF routes
only. Category requests could therefore reach the route handler with an expired
access token, receive a backend 401, and clear an otherwise usable refresh
session.

`/api/categories` was added to the middleware's refresh-only prefixes. A
regression test covers an expired access token plus a valid refresh token and
asserts that the category request receives refreshed cookies without a redirect.

### RF-004: post-login redirects are restricted to local paths

Both password login and Google login previously passed the user-controlled
`next` query parameter directly to `router.replace()`.

A shared `safeAuthRedirect()` boundary now:

- requires an absolute application path beginning with a single `/`;
- rejects absolute URLs, protocol-relative URLs, backslashes, and control
  characters;
- parses against a fixed non-production origin and verifies the origin remains
  unchanged;
- preserves a valid path, query string, and fragment; and
- falls back to `/planner` for every invalid input.

Both login methods use the same helper. Unit tests cover valid paths and common
external/protocol-relative/backslash/protocol payloads.

### RF-002: backend roadmap was reconciled with the implementation

The roadmap now records that:

- `Task.created_at` and `Task.completed_at` were migrated to server-owned
  `DateTimeField` values in migrations 0007 through 0009;
- `google.oauth2.id_token.verify_oauth2_token` is called with the configured
  audience and performs issuer/audience/expiry validation; and
- the proposed `select_related()` fix was based on an unmeasured N+1 claim.
  The current `PrimaryKeyRelatedField` representation uses DRF's PK-only
  optimization, so query work must begin with an `assertNumQueries` failure.

### RF-001: architecture documentation was refreshed

The architecture document now describes the `/planner` route, Next.js BFF,
Django task/category APIs, API-backed repository, current server/client domain
boundary, and known reliability limitations. The root README remains separate
because it already contained an uncommitted owner change when this pass began.

**Correction, 2026-08-06 (RF-008 follow-up):** the sentence above is a record
of the working-tree state when the first pass began, not the current repository
state. The README and its credential block were subsequently included in
checkpoint commit `0490abf`. A later forward-only change removes the credential
from the current README while preserving existing commits, so account rotation
and the repository-history decision remain owner actions. See the
[RF-008 mitigation record](2026-08-06-credential-removal.md).

**Update, 2026-08-06 (independent review):** this refresh itself went stale
within the same day. It described RF-005's transactional commands as
unimplemented/planned — "the main planned backend architecture improvement"
— while nest and promote-subtask were already implemented in the same
working tree, contradicting `docs/refining/README.md`'s own RF-005 row a few
paragraphs away. The "Domain boundary," "Error and consistency model," and
"Backend resources" sections have been corrected to describe the actual
split (nest/promote are atomic server commands; detach/delete-occurrence/
reschedule/reorder remain client-owned) and the real `If-Match`/version
contract on generic Task writes. This is the kind of drift RF-001 exists to
catch — a same-day correction, not a new class of problem.

### RF-011: pull-request CI was added

GitHub Actions now uses independent backend and frontend jobs:

- Backend: Python 3.12, dependency installation, Django system check,
  migration-drift check, and the accounts/tasks/config test suites against the
  SQLite fallback.
- Frontend: Node.js 20, reproducible `npm ci`, full tests, lint, and a clean
  production build.

The workflow also uses read-only repository permissions and cancels superseded
runs for the same branch/ref.

## Verification

The focused frontend suite passed:

```text
Test Files  3 passed (3)
Tests      17 passed (17)
```

Command:

```bash
npm test -- src/middleware.test.ts \
  src/features/auth/lib/safe-redirect.test.ts \
  src/features/auth/components/google-sign-in-button.test.tsx
```

The full frontend suite then passed:

```text
Test Files  53 passed (53)
Tests      731 passed (731)
```

`npm run lint` completed with zero errors. It still reports pre-existing unused
test-parameter warnings, one hook dependency warning, and the Next.js 15
`next lint` deprecation notice; those remain tracked under RF-016.

All relative Markdown links resolve, and `git diff --check` is clean for this
change set. The root README is excluded from that statement because its
pre-existing uncommitted credential block contains trailing whitespace and was
not modified during this pass.

A second local production build was not started because two owner-run Next.js
processes currently hold `.next/trace`; the earlier build attempt failed with a
Windows `EPERM` file lock. The new CI job provides the required clean build
environment without terminating the owner's development servers.

## Follow-up

RF-007 was completed in the next refinement change. The next bounded backend
slice RF-009 is now resolved; RF-005 remains the stronger, larger backend
portfolio signal.
