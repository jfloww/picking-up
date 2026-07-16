# Landing + Auth Screens Design — "Tesla-minimal"

Date: 2026-07-15
Status: Approved by JJ (visual selections made via brainstorming companion)

## Scope

Redesign of the three public-facing pages of Picking Up on the new Tailwind v4 + shadcn/ui stack:

- `/` — landing page
- `/login` — sign in
- `/signup` — account creation

Out of scope: the `/app` task workspace (not yet designed), any auth *behavior* change. All existing route handlers, middleware, cookie handling, and Django API calls stay exactly as they are — this is a presentation-layer rebuild only.

## Design decisions (as selected)

| Question | Decision |
|---|---|
| Scope | Login + signup + landing together |
| Personality | Calm & focused, interpreted as "Tesla-literal minimal" |
| Auth layout | Pure white page, wordmark top-left, centered ~360px column, large light heading, black pill button |
| Accent | Monochrome UI with **steel blue `#3b6b96` as a whisper** |
| Landing hero | Headline + product screenshot rising from the fold (hero B) |

## Design language

- **Surfaces:** pure white `#ffffff`. Near-black text `#171a1c`. Gray hierarchy: secondary text `#5f6a72`, placeholders/labels `#8b9299`, input fill `#f2f3f4`, hairlines `#e5e7e6`.
- **Accent (steel blue `#3b6b96`), used ONLY for:** the "UP" in the wordmark, input focus ring (border + soft `rgb(59 107 150 / 14%)` halo), links, future success states. Never for large areas.
- **Typography:** Geist (already wired in `layout.tsx` as `--font-sans`). Large headings at weight 200–300 with slightly tight letter-spacing. Wordmark: `PICKING UP` uppercase, small size, wide letter-spacing (~0.3em), weight 600.
- **Buttons:** pill radius (9999px). Primary: solid `#171a1c`, white text. Secondary: white, `#d6dadd` hairline border, near-black text.
- **Inputs:** Tesla-style — `#f2f3f4` fill, no visible border at rest, rounded (~8px), border + blue halo on focus.
- **Dark mode is in scope**, with a sun/moon toggle. Dark palette mirrors the light one: near-black background `#0f1214`, raised surfaces `#171b1e`, white text `#f3f5f6`, gray hierarchy inverted, input fill `#22272b`, hairlines `rgb(255 255 255 / 10%)`. Primary button inverts: white pill, near-black text. Steel blue lightens to `#6f9cc4` in dark so the whisper stays visible. Theme is applied via shadcn's `.dark` class using `next-themes`. **Dark is the default theme**; the toggle switches to light and the choice persists across visits (no flash on load). Toggle lives in the landing nav and the top-right corner of both auth pages.

## Pages

### `/` landing
Top nav: wordmark left, "Sign in" secondary pill right. Hero: short ultra-light headline, one-line gray subline, two CTAs — "Get started" (primary → `/signup`), "Sign in" (secondary → `/login`). Below the fold: the task app shown inside a clean hairline frame with soft shadow, rising from the bottom of the hero.

**The screenshot is a hand-built CSS mock of the future task UI for now** (sidebar + task rows + one circled checkbox in steel blue). Follow-up (tracked): replace with a real screenshot when the task workspace exists.

Minimal footer: wordmark + year. Static page, no scroll effects in v1.

### `/login`
Wordmark top-left. Centered column ~360px. "Sign in" heading (light weight, large). Email + password fields with small gray labels. Full-width black pill "Sign in". Below: quiet "Create account" link (steel blue). Errors: slim destructive Alert above the form, fed by the existing error flow.

### `/signup`
Identical skeleton. "Create account" heading. Email, password, confirm-password (client-side match check before submit — this is presentation-layer validation, the API contract is unchanged). Link back to `/login`.

Both auth pages keep their existing submit handlers and redirect behavior.

## Implementation shape

1. **globals.css:** set the shadcn theme variables (`--primary`, `--background`, `--muted`, `--ring`, `--radius`, etc.) to this palette. **Delete the legacy hand-rolled variables and page styles** — their names collide with shadcn tokens (`--accent`, `--muted`, `--border`) and they are superseded by this design.
2. **Rebuild the three pages** with Tailwind utilities + installed shadcn components (`Button`, `Input`, `Label`, `Card` where useful, `Alert` for errors).
3. **Shared pieces:** a `Wordmark` component (used by nav + auth pages) and an `AuthLayout` wrapper for the two auth pages.
4. Responsive: single column throughout; nav collapses gracefully; hero type scales down; auth column goes full-width with padding on small screens.

## Verification

- `tsc --noEmit` and `next build` clean.
- Manual run of real flows against dev servers: signup → redirect, login with wrong password → error alert shown, login success → `/app`, logout.
- Screenshots of all three pages at desktop and ~375px widths.

## Follow-ups (not in this build)

- Replace hero mock with real task-UI screenshot (after task workspace exists).
- Restyle `/app` placeholder onto the new system when the task UI is designed.
