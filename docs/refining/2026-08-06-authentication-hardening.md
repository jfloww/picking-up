# RF-009: Authentication Consistency and Abuse Controls

- Date: 2026-08-06
- Status: Resolved
- Scope: Django password login, registration, and Google sign-in

An independent review on 2026-08-06 verified every falsifiable claim in this
record against the running code and the installed dependency source (Simple
JWT, DRF throttling, Django's password hashers) rather than taking the
prose on faith, and found the headline claims accurate: the serializer
delegation, the identical-401 behavior across wrong-password/nonexistent-
email/inactive-user, the timing-equalization (which turns out to be more
complete than this record argues — Django's own `verify_password` fake-
runtime path independently covers Google-only accounts with an unusable
password, not just the `make_password()` call this record credits), the
`AUTHENTICATION_BACKENDS` ordering, and the throttle IP-keying, rates, and
`NUM_PROXIES` wiring. It also found three operational gaps not previously
tracked and recorded below. The 76- and 100-test figures in this dated record
are historical checkpoints; the final combined-tree count is maintained in
the refinement register's PR verification section.

## Problem

Password login used a handwritten serializer that queried the User table before
calling Django authentication and manually issued JWTs. That caused three
problems:

1. authentication failures did not follow Simple JWT's standard 401 contract;
2. a nonexistent email skipped password hashing, creating a measurable account-
   existence timing signal; and
3. login, registration, and Google sign-in had no abuse throttles.

Using DRF's in-process default cache would also make each gunicorn worker keep a
different request history. Trusting an arbitrary `X-Forwarded-For` value would
let a direct client change the IP identity used by a throttle.

## Resolution

### Standard email authentication

`EmailTokenObtainPairSerializer` now subclasses
`TokenObtainPairSerializer`. It retains Simple JWT's token issuance,
`last_login` update, authentication rule, and 401 failure behavior while
validating and normalizing the email field.

`EmailBackend` performs a case-insensitive email lookup and uses Django's normal
password verification plus `user_can_authenticate()`. When an email does not
exist, or the database unexpectedly contains multiple case-insensitive matches,
the backend calls `make_password()` with the submitted password before failing.
This preserves expensive password-hash work on the negative path. The standard
`ModelBackend` remains configured after it so Django admin username login still
works.

Wrong passwords, nonexistent emails, and inactive users now return the same
Simple JWT 401 body. Missing fields, malformed email values, and malformed JSON
remain input errors and return 400 before authentication.

### Endpoint-specific throttling

Each public credential endpoint applies two IP-based DRF throttles:

| Endpoint | Burst | Sustained |
|---|---:|---:|
| Password login | 5/minute | 100/day |
| Registration | 3/minute | 20/day |
| Google sign-in | 10/minute | 200/day |

Rates can be overridden through the `DJANGO_AUTH_*_RATE` environment variables
listed in `backend/.env.example`. A rejected request returns 429 and DRF's
`Retry-After` header. Limits are keyed by IP rather than account, so the control
does not create a per-account lockout primitive.

### Worker-shared cache and proxy identity

Development uses a local-memory cache. With `DJANGO_DEBUG=False`, the documented
single-VM deployment uses Django's file cache at `DJANGO_CACHE_LOCATION`; Django
creates the directory with owner-only permissions, and both gunicorn workers
share the same throttle histories.

DRF trusts zero forwarding proxies by default. The nginx deployment runbook now
sets `DJANGO_NUM_PROXIES=1`, matching its one trusted proxy hop and selecting the
last address nginx appends to `X-Forwarded-For`. This prevents a caller-supplied
leading value from becoming the throttle identity.

## Verification

Automated coverage now includes:

- successful case-insensitive email login and Simple JWT `last_login` behavior;
- identical 401 responses for wrong password, nonexistent email, and inactive
  user;
- an asserted dummy `make_password()` call for a nonexistent email;
- missing field, malformed email, and malformed JSON input;
- login burst and sustained 429 responses;
- independent registration and Google sign-in burst limits;
- `Retry-After` on a throttled login response; and
- client-IP selection behind one trusted proxy.

Verification completed on the SQLite fallback:

- focused authentication and throttle tests: 12 passed;
- full backend suite: 76 passed;
- `manage.py check`: no issues;
- `makemigrations --check --dry-run`: no changes; and
- two independent production-configured Django processes successfully wrote
  and read the same file-cache probe value.

Oracle was not exercised by this refinement.

## Gaps found in review (2026-08-06)

- **Burst-rejected requests still consume the sustained daily budget —
  resolved.** DRF's `check_throttles` evaluates every throttle
  unconditionally, so a request the burst throttle rejects was still
  recorded by the sustained throttle. Verified empirically (2/min + 10/day
  case): 12 rapid requests exhausted the 10/day bucket, 10 of which were
  already 429'd by the burst limit. Fixed with a `FirstFailureThrottleMixin`
  (`backend/apps/accounts/throttles.py`) applied to all three throttled
  views: it overrides `check_throttles` to stop evaluating once one
  throttle has already rejected the request, so a later throttle's
  `allow_request()` — and its recording side effect — never runs for a
  request already known to be rejected. Covered by a new regression test,
  `test_burst_rejected_requests_do_not_consume_the_sustained_budget`, which
  asserts the sustained throttle's cache history has exactly 1 entry after
  5 rapid requests (1 allowed, 4 burst-rejected) rather than 5.
- **`DJANGO_NUM_PROXIES` defaults to 0 with nothing enforcing the runbook
  step that sets it to 1 in production — resolved.** If that step were
  missed, `get_ident()` would return `REMOTE_ADDR`, which behind nginx is
  `127.0.0.1` for every request — collapsing the entire deployment into one
  shared throttle bucket and turning the point above into a whole-site
  lockout. Fixed with a settings-time guard in `backend/config/settings.py`,
  mirroring the existing `SECRET_KEY` check: `raise ImproperlyConfigured`
  when `not DEBUG and DJANGO_NUM_PROXIES == 0`. Verified with `manage.py
  check` (passes locally, where `DJANGO_DEBUG=True`) and by inspection —
  the guard fires from the same code path already proven for the
  `SECRET_KEY` case.
- **`EmailBackend`'s `MultipleObjectsReturned` branch was a silent,
  permanent, undiagnosable lockout — resolved.** If two `User` rows differ
  only by email case — reachable via admin or shell, which bypass the
  lowercasing `RegisterSerializer` and the Google view apply —
  `email__iexact` raises, and both accounts become permanently unable to
  log in by password. Fixed two ways: `backends.py`'s exception handler now
  logs a warning naming the ambiguous email (after paying the same
  `make_password()` cost as the ordinary not-found path, so timing doesn't
  distinguish the two cases) instead of failing silently; and
  `RegisterSerializer.validate_email` now checks `email__iexact` instead of
  an exact match, so the API's own registration path can no longer create
  the ambiguity in the first place — only a pre-existing admin/shell-created
  pair can still trigger it. Covered by two new tests:
  `test_register_rejects_a_case_variant_duplicate_email` (API path is
  closed) and `test_case_variant_duplicate_emails_fail_login_with_a_logged_warning`
  (the residual admin/shell path is now diagnosable via `assertLogs`).
- Registration remains an unambiguous account-existence oracle ("An account
  with this email already exists.") — defensible as normal registration UX
  and now rate-limited to 20/day/IP, but this record's enumeration-closed
  framing didn't previously carve out that deliberate exception. No code
  change; noted here for the record.

## Final review round (2026-08-06)

A final review of the RF-018/RF-019 fix commits found no Critical or
functional-Important issues, but flagged two worth closing and one worth
documenting:

- **`FirstFailureThrottleMixin` bypassed DRF's `throttled()` extension
  point — fixed.** It raised `exceptions.Throttled` directly instead of
  calling `self.throttled(request, duration)`, DRF's intended override
  point; identical behavior today (nothing in this codebase overrides
  `throttled()`), but a future view-level customization would have been
  silently skipped. Also removed a dead list-collect-then-`max()`
  reduction: the mixin's `break` on the first failing throttle means at
  most one duration can ever be recorded, so the multi-throttle reduction
  it inherited from DRF's default implementation no longer does anything.
- **A losing racer in `RegisterSerializer.create()` got an unhandled
  `IntegrityError` (500), not the validation error the sequential case
  gets — fixed.** The `__iexact` pre-check (see RF-019 above) narrows the
  registration race but isn't itself atomic: two concurrent case-variant
  registrations can both pass it before either commits, and the database's
  unique index — not the pre-check — is the real atomic boundary. `create()`
  now catches `IntegrityError` and converts it to the same
  `{"email": ["An account with this email already exists."]}` validation
  error the pre-check raises sequentially. Covered by a new test that
  exercises `create()` directly against a pre-existing row, since
  reproducing genuine concurrency isn't practical in a test.
- **`DJANGO_NUM_PROXIES` has no way to express a legitimate zero-proxy
  deployment — documented, not fixed.** The settings-time guard treats `0`
  as "someone forgot to set this," but `0` is also the correct value for
  gunicorn exposed directly with no reverse proxy in front of it. The
  documented deployment topology always uses nginx with
  `DJANGO_NUM_PROXIES=1` (`docs/planning/7. deployment-runbook.md`), so
  this isn't a live gap for this project, but a genuinely proxy-less
  deployment would need to change the guard (e.g. distinguish "explicitly
  set to 0" from "left at the default" via `env.int(..., default=None)`)
  rather than work around it.

## Independent-review follow-up: identity linking and BFF errors (2026-08-06)

The independent review found two boundary failures beyond the throttle core:

- Two first-time Google requests for the same existing password account could
  both miss the identity lookup. The loser of `GoogleIdentity.objects.create()`
  raised an uncaught uniqueness `IntegrityError` and returned 500. The existing-
  account branch now uses a savepoint, catches the database race, and reloads
  the winning `sub` identity. If no matching winner exists, it returns an
  explicit 409 rather than guessing which account to link.
- Django correctly returned throttle status 429 and `Retry-After`, but the Next
  login/register/Google routes flattened every upstream failure to 400 and
  discarded the header. `apiRequest()` now throws a status-aware
  `ApiResponseError`, and all three auth routes use one response helper that
  preserves the upstream status and `Retry-After`.

The broader RF-014 error-envelope work remains open: response bodies still use
multiple shapes. This follow-up closes only status/header transport for auth.

Verification at this checkpoint:

- backend `GoogleAuthApiTests`: 12/12 passing;
- frontend server-helper and Google-route selection: 10/10 passing;
- frontend TypeScript: clean.

## Operational limits

- DRF explicitly implements fuzzy, non-atomic throttling. Concurrent requests
  can exceed a configured boundary by a small amount; this is abuse friction,
  not a hard quota or billing control.
- The file cache shares state across processes on one VM only. Before adding a
  second application host, move throttle state to Redis or another distributed
  cache and add an integration test.
- Users behind one NAT share an IP budget. Rates should be adjusted from
  observed legitimate traffic rather than guessed upward without evidence.
- `DJANGO_NUM_PROXIES` must continue to equal the number of trusted proxy hops.
  A topology change requires a settings and regression-test update.
- FileBasedCache calls `_cull()` on every write, which does a full-directory
  scan and, at the configured 10,000-entry cap, deletes a random third of
  entries — silently resetting throttle histories. Not a problem at this
  project's scale; worth knowing if traffic grows.
