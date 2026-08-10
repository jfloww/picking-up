# Design: Footer Version Info & Login Loading Feedback

- Date: 2026-08-07
- Status: Approved by owner, not yet implemented

## Problem

Two small, unrelated-but-small-enough-to-bundle UX gaps:

1. The site footer shows no version indicator.
2. Login (both email/password and Google) gives inconsistent or no visual
   feedback during the roughly one-to-few-second server round trip
   (browser → Next.js BFF → Django → DB → back), which can read as the app
   being frozen. The email/password form's submit button already shows
   "Working..." and disables itself, but that feedback ends before the real
   gap: after the button's own fetch resolves, `router.replace()` +
   `router.refresh()` re-render `/planner` (an async server component that
   itself calls `getCurrentUserOrNull()`), and no `loading.tsx` exists
   anywhere in the App Router tree — so that render gap is silent. The
   Google sign-in path has no loading feedback at all, at any point.

## Scope

In scope: `SiteFooter`'s version display; a backend `/api/health`
endpoint; a frontend diagnostics page comparing frontend/backend build
info; `AuthForm`'s submit-button loading state; `GoogleSignInButton`'s
loading state; a new `/planner` route `loading.tsx`.

Out of scope, per explicit choices made during brainstorming:

- A general-purpose, reusable loading-state pattern for other slow
  operations elsewhere in the app (task fetches, mutation queue, etc.).
  This is scoped to the login flow only. Revisit as a separate spec if/when
  another slow operation needs the same treatment.
- API contract versioning (`/api/v1/`-style URL versioning). Worth
  learning later; not needed while there is a single web client controlled
  by the same team on both ends.
- Any form of frontend/backend version-compatibility enforcement (blocking
  or warning the user when the two differ). Build/version identification
  is a debugging and ops tool, not a gate — Vercel and Cloud Run deploy
  independently even from the same push, so brief version skew between
  them is expected and normal, not an error condition.

## Feature 1: Version visibility (frontend footer, backend health endpoint, diagnostics page)

Three pieces, deliberately decoupled — the public-facing footer never
makes a live cross-service call just to render a version string; only the
dedicated diagnostics page does that.

### Backend: `GET /api/health`

New, unauthenticated DRF view (health/build-info endpoints are
conventionally public — this also becomes a real target for uptime
monitoring later, not just version display) returning:

```json
{
  "status": "ok",
  "service": "picking-up-api",
  "version": "0.1.0",
  "commit": "a84c20f",
  "environment": "production"
}
```

- `version` is read from a new `backend/VERSION` file — a plain
  single-line text file (e.g. `0.1.0`), committed to the repo and bumped
  manually on release. This mirrors how the frontend already tracks its
  own version in `package.json`, and deliberately does **not** try to
  force one shared version number across both — they're independently
  deployed, so they're allowed to carry independent version numbers, the
  same way the "don't enforce compatibility" decision above implies they
  can legitimately differ.
- `commit` is read from a new `DJANGO_GIT_SHA` environment variable via
  the existing `django-environ` `env()` helper
  (`env("DJANGO_GIT_SHA", default="unknown")`), following this codebase's
  established `DJANGO_`-prefixed env var naming
  (`DJANGO_DEBUG`/`DJANGO_SECRET_KEY`/`DJANGO_ALLOWED_HOSTS`). It must be
  set at deploy time to the short commit SHA of the code being deployed
  (e.g. `--set-env-vars DJANGO_GIT_SHA=$(git rev-parse --short HEAD)` on
  whatever `gcloud run deploy` invocation is the actual current deploy
  step — this spec doesn't assume a specific CI pipeline file, since none
  exists in the repo today).
- `environment` is read from a new `DJANGO_ENVIRONMENT` environment
  variable (`env("DJANGO_ENVIRONMENT", default="development")`) — a new
  setting distinct from the existing boolean `DJANGO_DEBUG`, since "which
  environment is this" and "is debug mode on" are different questions even
  though they'll usually move together.
- Registered at `/api/health/` in `config/urls.py`.

### Frontend: `SiteFooter` shows only its own info

Unchanged from the original plan in spirit, extended with a commit SHA:
`SiteFooter` (`frontend/src/components/site-footer.tsx`, a server
component, no `"use client"`) imports `frontend/package.json` directly for
`version` (`resolveJsonModule: true` already set in `tsconfig.json`, no
new build config, no client-bundle exposure) and reads
`process.env.VERCEL_GIT_COMMIT_SHA` for the commit — a Vercel-provided
system environment variable, automatically present in every Vercel
deployment with no configuration required. When unset (local dev, or any
non-Vercel host), the SHA is simply omitted rather than shown as a
placeholder.

Rendered as `© 2026 JFLOWW · v0.1.0 (a84c20f)` when a SHA is available,
`© 2026 JFLOWW · v0.1.0` otherwise. The version text is a link to the new
diagnostics page (see below) — discoverable for anyone who cares to click,
without adding visual noise for anyone who doesn't.

Already renders on both the landing page and `/planner`, so both surfaces
get this automatically.

### Frontend: a diagnostics page comparing both

New route `frontend/src/app/diagnostics/page.tsx` — unauthenticated (no
sensitive data is exposed; matches `/api/health`'s own accessibility), a
server component that reads its own frontend version/commit the same way
`SiteFooter` does, and additionally fetches the backend's health info
through a new same-origin BFF route,
`frontend/src/app/api/health/route.ts`, which proxies to Django's
`/api/health/`. This keeps the established pattern intact: the browser
never calls Django directly for anything, including this.

Displays both side by side, purely informationally:

```
Frontend: 0.1.0 (a84c20f)
Backend:  0.1.0 (a1b2c3d)
```

No compatibility check, no warning styling if they differ — this page's
only job is "let a developer see what's actually running," per the Scope
section above.

## Feature 2: Login loading feedback

All three pieces reuse the same visual language: `lucide-react`'s
`Loader2` icon with Tailwind's built-in `animate-spin` utility, next to
short status text — matching the app's existing minimal style (no new
spinner component, no full-page overlay, no skeleton).

### `AuthForm`'s submit button

`frontend/src/features/auth/components/auth-form.tsx` already tracks
`isSubmitting` and already disables the button, showing generic
"Working..." text. Change only the button's visible content while
submitting: a small spinning `Loader2` icon followed by mode-specific text
— "Signing in…" when `mode === "login"`, "Creating account…" when
`mode === "signup"` — instead of "Working...". No new state, no behavior
change beyond the visual.

### `GoogleSignInButton`

`frontend/src/features/auth/components/google-sign-in-button.tsx`
currently has no loading state at all between the Google credential
callback firing and the `router.replace`/`router.refresh` redirect. Add:

- A new `isSubmitting` boolean state, set `true` at the start of the
  `google.accounts.id.initialize` callback and never explicitly reset on
  success (the component unmounts on navigation; on failure it resets to
  `false` in the same place the existing `error` state is set, so the UI
  returns to its normal, retryable state).
- A reentrancy guard at the top of the callback (`if (isSubmitting)
  return;`) — Google's rendered button is outside this component's direct
  control, so unlike `AuthForm`'s own `<button disabled>`, nothing else
  stops a second callback invocation while the first is still in flight.
- While `isSubmitting` is `true`, render a spinner + "Signing in…" in the
  same conditional slot the `error` `Alert` already occupies below the
  button (mutually exclusive with the error state — a fresh attempt clears
  any prior error).

### `/planner` route loading state

New file: `frontend/src/app/planner/loading.tsx`. This is a plain Next.js
App Router convention, not custom plumbing: Next.js automatically wraps a
route segment in a Suspense boundary when a sibling `loading.tsx` exists,
and renders it while that segment's async server component work is
in flight — here, `PlannerPage`'s own `await getCurrentUserOrNull()`. This
covers the post-login redirect gap (both email/password and Google, since
both end in the same `router.replace` + `router.refresh` pattern) and, as
a free side effect, any other slow direct navigation to `/planner` —
without any manual loading-state wiring in the auth components
themselves.

Content: centered spinner + "Loading your planner…", matching the other
two pieces' visual language. Same layout shell proportions as
`PlannerPage` itself (full-height flex column) so the transition doesn't
visibly jump.

## Testing

- Backend: a new test module (matching wherever `apps/tasks`'s or
  `apps/accounts`' existing API tests live, for the health endpoint's own
  app or a small dedicated one) asserting `GET /api/health/` returns 200
  with the documented shape, that `version` reflects the `backend/VERSION`
  file's contents, and that `commit`/`environment` fall back to their
  documented defaults (`"unknown"` / `"development"`) when their env vars
  are unset.
- `frontend/src/components/site-footer.test.tsx` (existing file): add
  assertions that the rendered footer text includes the version string
  read from `package.json`, that it includes the commit SHA when
  `VERCEL_GIT_COMMIT_SHA` is set, and that it's omitted (not shown as a
  placeholder) when that env var is unset.
- `frontend/src/app/api/health/route.ts`: a route-handler test (matching
  this codebase's existing BFF route test conventions, e.g. the pattern
  already used for the tasks/categories BFF routes) asserting it proxies
  Django's `/api/health/` response through.
- `frontend/src/app/diagnostics/page.tsx`: a test asserting both the
  frontend's own version/commit and the (mocked) backend response render
  side by side.
- `frontend/src/features/auth/components/auth-form.test.tsx` (new file —
  none exists today; this spec only adds coverage for the change being
  made here, not a retroactive full test suite for the rest of the form):
  assert the submit button shows the spinner and mode-specific text while
  a submission is in flight, for both `mode="login"` and `mode="signup"`.
- `frontend/src/features/auth/components/google-sign-in-button.test.tsx`
  (existing file): add a test asserting the loading indicator appears
  during the credential-submission window, and a test asserting a second
  callback invocation while already submitting is a no-op (the
  reentrancy guard), on top of whatever this file already covers.
- `frontend/src/app/planner/loading.tsx`: a lightweight render test
  asserting the spinner and text render, matching whatever the lightest
  existing precedent for a trivial presentational component in this
  codebase looks like (check `site-footer.test.tsx` for that precedent
  when implementing, rather than inventing a new testing style here).

## Error handling

No new error paths. Existing error handling — the `Alert` shown on failed
login, failed registration, or failed Google sign-in — is untouched. Every
new loading state is purely additive visual feedback, cleared in the same
`finally` blocks / early-return branches that already exist today.
