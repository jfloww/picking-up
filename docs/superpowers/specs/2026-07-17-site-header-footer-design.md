# Shared Site Header & Footer Design

**Date:** 2026-07-17
**Status:** Approved

## Concept

Extract the landing page's header/footer into shared components (`SiteHeader`,
`SiteFooter`) and apply them to the landing page (`/`) and the app workspace
(`/app`). The header shows theme toggle + auth state (Sign in, or the user's
name + Sign out when logged in); the footer shows the wordmark, copyright, and
a link to the owner's GitHub profile. `/login` and `/signup` keep their
current minimal header (Wordmark + theme toggle only, no footer) — they're
focused single-purpose forms, and middleware already redirects logged-in users
away from them, so there's no auth state to show there.

## Components

### `SiteHeader` — `frontend/src/components/site-header.tsx`

Plain (non-`"use client"`) component, props: `{ user: CurrentUser | null }`.
Full-bleed bar (`flex items-center justify-between px-6 py-5 sm:px-10`, the
landing page's current header styling) containing:

- **Wordmark**, always linking to `/` — regardless of auth state, clicking it
  from anywhere (including `/app`) returns to the landing page, never to
  `/app` directly.
- Right side: `ThemeToggle`, plus either:
  - **Logged out:** a "Sign in" button (outline, small, rounded-full — same
    styling the landing page uses today), linking to `/login`.
  - **Logged in:** the user's display name as text, followed by the existing
    `LogoutButton` component (reused as-is; already a client component with
    its own pending/disabled state).

Display name resolves via an exported pure function for testability:

```ts
export function displayName(user: CurrentUser): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || user.email;
}
```

### `SiteFooter` — `frontend/src/components/site-footer.tsx`

No props. Full-bleed bar (`flex items-center justify-between border-t
border-border px-6 py-6 sm:px-10`, matching the landing page's current
footer) containing:

- **Wordmark** (dimmed, `opacity-60`) on the left.
- On the right: `© 2026 Picking Up` text, plus an icon-only link (ghost/
  rounded-full button styling matching `ThemeToggle`, using lucide-react's
  `Github` icon — if that export doesn't exist in the installed lucide-react
  version, fall back to a plain text "GitHub" link in the same button
  styling instead) to `https://github.com/jfloww`, opened in a new tab
  (`target="_blank" rel="noopener noreferrer"`, `aria-label="GitHub profile"`).

## Pages

### Landing page — `frontend/src/app/page.tsx`

Becomes an `async` Server Component. Fetches `const user =
await getCurrentUserOrNull()` once, passes it to `SiteHeader`, and uses it to
decide the hero CTA:

- **Logged out:** unchanged — "Get started" (→ `/signup`) and "Sign in"
  (→ `/login`) buttons.
- **Logged in:** a single "Open app" button (→ `/app`, same `lg`/primary
  styling as today's "Get started" button), replacing both — a signed-in
  visitor shouldn't be steered back through login/signup.

Renders `<SiteFooter />` after `<main>`, replacing the inline footer markup
that exists today.

### App workspace — `frontend/src/app/app/page.tsx`

Becomes `async`, fetches `user` the same way, and restructures to the same
`flex min-h-svh flex-col` shape as the landing page: `SiteHeader` (full-bleed,
replacing the old inline Wordmark+LogoutButton header), then `<main>` keeping
its existing `max-w-6xl` content constraint around `TaskCalendar`, then
`SiteFooter`.

## Data flow & error handling

- **`getCurrentUserOrNull()`** (new, `frontend/src/features/auth/api/auth.ts`):
  wraps the existing `requestCurrentUser()` in a try/catch, returning `null`
  on any failure — expired/missing token, or Django unreachable. Both pages
  call it exactly once and pass the result down; `SiteHeader` never fetches
  on its own, so there's no duplicate network round-trip and no
  client-side loading/skeleton state to design for (auth state is resolved
  before the page renders).
- **`frontend/src/app/api/auth/me/route.ts`** is refactored to call
  `getCurrentUserOrNull()` too, centralizing the try/catch-to-null logic in
  one place. External behavior is preserved (still responds 401 with an
  `error` field on failure; the exact error message text may change to a
  fixed "Unauthorized.", which nothing in the codebase currently parses).
- **Middleware gap this design closes:** today `middleware.ts` only attempts
  an access-token refresh for `/app` and `/login`/`/signup`; `/` is
  untouched. Since access tokens expire after 15 minutes, a logged-in user
  who lands on `/` with an expired access token (but a still-valid refresh
  token) would see a stale "Sign in" header until their next visit to
  `/app` silently fixes it. Fix: add a third route category — `/` is
  "refresh-only": middleware attempts the same silent refresh-and-cookie-set
  it already does for other routes, but never redirects based on auth state
  either way (both logged-in and logged-out are valid on the landing page).
  No change to the middleware's route matcher is needed — `/` is already
  covered by the existing matcher; only the internal route-category logic
  changes.
- If Django is unreachable or the refresh fails, behavior degrades the same
  way it already does elsewhere in the app: no cookies are set, the user is
  treated as logged out for that render, and nothing crashes.

## Testing

- **Unit-testable, get Vitest + RTL tests** (matching this repo's existing
  colocated-test convention): `displayName()`'s three resolution branches
  (full name, username fallback, email fallback); `SiteHeader` rendering
  (logged-out shows Sign in, logged-in shows name + Sign out, theme toggle
  always present); `SiteFooter` rendering (GitHub link href/target/rel,
  copyright text); `getCurrentUserOrNull()`'s try/catch-to-null behavior
  (mocking the underlying `requestCurrentUser`).
- **Not unit-tested:** the `page.tsx` Server Components themselves and the
  middleware refresh-only branch — this repo has no established pattern for
  mocking `cookies()`/Next.js request context in tests, and the existing
  middleware has no test coverage today either. These are covered by manual
  browser verification instead: visit `/` and `/app` both logged in and
  logged out; confirm the hero CTA swap; confirm clicking the Wordmark from
  `/app` returns to `/`; confirm the header still shows the correct name
  after an access token expires (or simulate by clearing just the access
  token cookie and reloading `/` with the refresh token still present).

## Out of scope

- Header/footer on `/login`/`/signup` (explicitly excluded per the approved
  design).
- User avatar images, dropdown account menus, or editable profile info.
- Changing the copyright year dynamically (stays hardcoded, matching the
  existing landing page).
- Any change to Django/backend auth endpoints.
