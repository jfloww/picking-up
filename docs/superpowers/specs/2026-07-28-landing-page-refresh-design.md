# Landing Page Refresh

**Date:** 2026-07-28
**Status:** Approved

## Problem

The landing page (`frontend/src/app/page.tsx`) is disconnected from the
actual app. Its hero copy ("Everything you need to do. Nothing else.") is
generic, and the visual beneath it (`components/task-mock.tsx`) is a
fabricated mockup with fake nav items ("Today", "Inbox", "Done") that don't
exist anywhere in the real product — no routines, due dates, subtasks,
drag-scheduling, or the cross-device sync that just shipped.

Separately, a Superdesign-authored mockup (`.superdesign/`, draft
`328ffbe2-d400-46de-b36e-6c6c716ad591`) proposed a bolder direction: dark,
large, high-contrast, with a traditional marketing nav (Features / How it
works) and an abstracted product visual (unlabeled colored timeline bars).

## Goal

Refresh the hero and its product visual so the landing page actually
reflects the current app, while keeping the calm, restrained tone the
product itself has — not adopting the Superdesign mock's tone wholesale.

## Scope decisions already made

Reconciling the two inputs (brainstormed in the terminal + browser-based
visual companion), explicitly decided:

**Keep from the Superdesign mock:**
- Dark-first presentation
- The "Pick up your day." headline (a tighter pun on the product name than
  the current tagline)
- The product-led split layout (copy on one side, product preview on the
  other — a real structural change from the current fully-centered, stacked
  layout)
- The real "All Day To-Do" / "Next Up" terminology (these are the actual
  `DayAgenda` section labels, not invented copy)

**Explicitly not adopted:**
- The oversized, heavy headline treatment — calmer typography and spacing,
  matching the product's existing restrained voice, not a high-energy SaaS
  hero
- The "Features" / "How it works" nav items — no new sections are being
  added in this scope; adding that nav without real content behind it would
  create dead links
- Abstracted, unlabeled colored timeline bars — the product preview must be
  faithful to the real Daily view: timeline blocks show actual task titles
  and times, the way `DayTimeline` really renders them
- The "View demo" CTA — no demo mode exists; keep exactly one primary
  action plus the existing sign-in path
- A "planned hours" stat in the preview's header — decided during visual
  review to drop it, no replacement

## Visual reference

Approved mockup (browser-based visual companion,
`.superpowers/brainstorm/6342-1785244786/content/reconciled-hero-v2.html`):
a dark card, 40px/semibold headline (calmer than the Superdesign mock's
oversized weight, more present than the current site's `font-extralight`),
subhead, one primary CTA ("Start planning") + existing sign-in link, and a
product preview panel to the right showing a realistic Daily view: a date
header with no stat line, a timeline column with labeled task blocks
(title + time range), and an agenda column with "All Day To-Do" and "Next
Up" sections.

## Design-system correction (unblocks faithful color use)

`.superdesign/design-system.md` documented the dark theme's brand/focus
accent as gold (`#d4a85f`) — a leftover from an earlier "Neural Noir"
exploration that was reverted to blue (`#6f9cc4` dark / `#3b6b96` light)
earlier in this project's history. `globals.css` has been blue for a while;
the doc was just never updated. **Already fixed** (not part of this
plan's implementation work — done directly during this brainstorm):
`design-system.md`'s Color section now matches `globals.css` exactly and
states `globals.css` as the source of truth for any future disagreement.

## Implementation approach

- Rebuild `page.tsx`'s hero section: replace the centered stack with a
  two-column layout (text column + preview column) at the `lg` breakpoint,
  stacking on narrower viewports (the current page has no responsive
  breakpoint handling to preserve here — this is new).
- Replace `components/task-mock.tsx`'s content entirely: drop the fake
  sidebar nav (`Today`/`Inbox`/`Done`) and rows; render a Daily-view-shaped
  preview with a date header (no stat line), a timeline column with 2-3
  labeled blocks (realistic titles + time ranges, matching how
  `DayTimeline` actually renders a block — reuse that component's real
  visual language: border-left accent, `bg-brand/10`-style tint, not
  invented styling), and an agenda column with "All Day To-Do" and "Next
  Up" section labels (matching `DayAgenda`'s real labels exactly) each
  showing one example task.
- This stays a **static, presentational mock** — not a live-wired
  `DailyView`/`DayTimeline`/`DayAgenda` instance. Reusing those components
  directly would require a `TasksProvider`, real auth-gated data, and
  drag-scheduling wiring that don't belong on a public marketing page.
  Match their visual language (colors, spacing, radius, label text) by
  eye/token reuse, not by importing and reconfiguring the real components.
- Update hero copy: headline "Pick up your day.", subhead "Plan what
  matters today, and see your whole week at a glance." (from the approved
  mockup), one primary CTA. For a logged-out visitor this is "Get
  started" → `/signup` (existing route/behavior) — the mockup's "Start
  planning" label is a copy option to decide during implementation, not a
  mandate to rename the existing button; keep "Sign in" as a secondary
  text link exactly as the page already does. For a logged-in visitor,
  keep the existing "Open app" → `/app` behavior unchanged.
- Dark-first means the preview and hero are designed and validated
  primarily against the dark theme (the product's actual default), but
  must still render correctly in light mode via the existing theme tokens
  — this page must stay theme-aware like the rest of the site (the
  `ThemeToggle` in `SiteHeader` still applies here); it is not becoming a
  permanently-dark, theme-locked page.
- No new nav items, no demo-mode CTA, no dependency additions. Only
  `frontend/src/app/page.tsx` and `frontend/src/components/task-mock.tsx`
  are expected to change; `SiteHeader`/`SiteFooter`/routing/auth are
  untouched.

## Non-goals

- No "Features" or "How it works" sections/pages.
- No demo mode.
- No changes to the actual `/app` Daily view, `DayTimeline`, or
  `DayAgenda` components — this only visually *references* their look.
- No changes to auth routes, middleware, or the sign-up/login flow itself.

## Testing

- `page.tsx`: existing test coverage (if any) for the logged-in vs.
  logged-out CTA branch must still pass with the new copy/labels; add
  coverage for whichever button labels/hrefs are finalized during
  implementation.
- `task-mock.tsx`: since it's `aria-hidden` (decorative), no new
  interaction tests are needed — a smoke-level render test confirming it
  mounts without error and shows the expected section labels is
  sufficient, matching how a purely presentational component would
  normally be tested elsewhere in this codebase.
