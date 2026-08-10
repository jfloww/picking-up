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

In scope: `SiteFooter`'s version display; `AuthForm`'s submit-button
loading state; `GoogleSignInButton`'s loading state; a new `/planner`
route `loading.tsx`.

Out of scope, per an explicit choice made during brainstorming: a
general-purpose, reusable loading-state pattern for other slow operations
elsewhere in the app (task fetches, mutation queue, etc.). This is scoped
to the login flow only. Revisit as a separate spec if/when another slow
operation needs the same treatment.

## Feature 1: Footer version

`SiteFooter` (`frontend/src/components/site-footer.tsx`) has no
`"use client"` directive — it's a server component — so it can import
`frontend/package.json` directly and read its `version` field at
render/build time. `resolveJsonModule: true` is already set in
`tsconfig.json`, so this needs no new build configuration, and since the
import happens server-side, the value never needs a `NEXT_PUBLIC_` env var
or any client-bundle exposure.

Rendered as `© 2026 JFLOWW · v{version}`, appended to the existing
copyright `<p>` (not a separate element) — the footer is already a tight,
single-line layout and this reads as one fact, not two.

`SiteFooter` already renders on both the landing page (`app/page.tsx`) and
the authenticated workspace (`app/planner/page.tsx`), so both surfaces get
the version automatically with this one change.

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

- `frontend/src/components/site-footer.test.tsx` (existing file): add an
  assertion that the rendered footer text includes the version string
  read from `package.json`.
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
