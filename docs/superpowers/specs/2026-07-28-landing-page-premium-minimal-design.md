# Landing Page: Premium Minimal Redesign

**Date:** 2026-07-28
**Status:** Approved
**Supersedes:** `docs/superpowers/specs/2026-07-28-landing-page-refresh-design.md` (shipped as PR #34) for the hero/preview layout and page structure. That spec's dark-first direction, real Daily-view terminology, and no-Features-section-scope-creep discipline all still hold as *principles* — this spec revises the specific layout, adds one new section, and adds motion.

## Problem

PR #34 shipped a side-by-side hero (headline/CTA left, `TaskMock` preview right, each roughly half the container width). Live feedback: it "looks fine but kind of small" — the preview reads as a small screenshot floating in a large column rather than a confident visual anchor. A follow-up sizing tweak (bigger padding/type inside the same split layout) treated the symptom, not the cause: a ~50/50 split caps how large the preview can ever feel, no matter how its internals are scaled.

Separately, the user benchmarked apple.com/mac (rejected as too heavy/maximalist — scroll-jacking, video-driven) and tesla.com (accepted as the right reference — restrained, but motion gives it presence) and asked for something that shows off the product without adding weight.

## Goal

Redesign the hero into what the user termed **"premium minimal"**: fewer, stronger elements — a confident (not tiny, not sparse) headline, a large faithful product preview as the primary visual anchor, one structured benefits section, and restrained motion (an entrance animation plus a looping product-lifecycle demo) — without scroll-jacking, gradients, decorative graphics, or constant ambient motion.

## Decisions made (brainstormed via terminal + visual companion mockup, approved)

**Hero structure changes from side-by-side to stacked:**
- Headline, subhead, and CTA row stack on their own, centered, above the preview — not competing for width with it.
- The product preview moves below, spanning nearly the full content container — this is what gives it "substantial screen presence," not internal padding/font tweaks.

**Headline:** stays "Pick up your day." (already-approved copy holds), rendered at ~60px / semibold / tight tracking — confident and calm, not ultra-light (the original PR #34 hero) and not aggressively bold (the Superdesign mock rejected earlier in this project's history).

**Subhead copy changes** to tie more directly to the new benefits framing: "Turn your to-dos into a clear plan — one day at a time, one week in view." (approved via the mockup). This replaces PR #34's "Plan what matters today, and see your whole week at a glance." — same idea, phrased to bridge into the Daily/Weekly benefit pair below it.

**CTA:** unchanged behavior from PR #34 — logged-in → "Open app" (`/app`); logged-out → primary "Get started" (`/signup`) + secondary "Sign in" (`/login`). Only its position changes (centered under the subhead instead of left-aligned).

**Content container:** 1120–1280px (approved mockup used 1200px as the concrete value) — replaces the current `max-w-6xl` (1152px, already close) for the hero and introduces the same container for the new benefits section, so the whole page reads as one deliberate column rather than drifting widths between sections.

**Product preview — primary visual anchor:**
- Spans the full content container width, well below the fold-defining headline.
- Depth comes from layered near-black surfaces (`bg-card` over `bg-background`), a 1px low-opacity border, and a large soft shadow — no gradients, no decorative imagery.
- Must stay faithful to the real Daily view: real section labels ("All Day To-Do", "Next Up"), realistic task titles/times, and the same visual grammar as `DayTimeline`/`DayAgenda` (border-left accent on timed blocks, `text-subtle` uppercase section labels) — this constraint from PR #34's spec is unchanged and still binds.
- Brand blue (`text-brand`/`border-brand`/`bg-brand/10`) is reserved for exactly what's meaningful: the one "active/current" timeline block, the "Next Up" checkbox outline, and the demo animation's completion state. It must not become a decorative accent applied broadly.

**New: "Focus your day" / "See your week clearly" / "Keep routines flexible" benefits section.**
This reverses PR #34's explicit "no Features section for now" constraint — a deliberate, user-directed scope change, not scope creep. Exact approved copy:

| Title | Description |
|---|---|
| Focus your day | Turn tasks into a clear timeline and actionable agenda. |
| See your week clearly | Understand your workload across the week at a glance. |
| Keep routines flexible | Repeat what matters and adjust one occurrence without breaking the whole series. |

Presentation: one structured section below the preview, three columns divided by thin vertical borders (matching the preview card's border treatment) — not three separate card/shadow "feature boxes," and no icons. A short bold title + one line of `text-muted-foreground` description each. This is the "polished, structured section rather than a collection of small generic feature cards" requirement from the brief.

**New: small trust line beneath the benefits section.** "Your tasks stay synced across devices." — centered, small (`text-subtle`-scale), no emphasis. Sync is real (shipped in PR #31/#32) but intentionally undersold relative to the three primary benefits, per the user's framing that it's "an expected reliability feature," not one of the three main product stories.

**Entrance animation:** on page load, headline → subhead → CTA row → preview fade up in a short staggered sequence (~0.7-0.8s each, ~120-150ms stagger, `cubic-bezier(0.16,1,0.3,1)`-style ease-out). Plays once per page load. No scroll-triggering, no repeat.

**Product-lifecycle demo animation:** after the entrance settles, one task in the preview's "Next Up" section — not the other two static example tasks — cycles: its checkbox fills to solid brand, its title takes on the "done" treatment (muted color, strikethrough), holds briefly, then resets and repeats. This demonstrates the core daily-focus interaction (completing a task) without touching the other two example rows, which stay legible as steady-state reference content. Continuous, gentle, non-scroll-triggered — it loops for as long as the page is open, but on a slow enough cycle (~7s+) that it reads as a subtle "the product is alive" signal, not an attention-grabbing distraction. This satisfies "preserve the subtle entrance animation and product-lifecycle demo" while staying inside "avoid... constant ambient motion" by keeping the cycle slow and the resting state visually calm.

**Explicitly rejected / out of scope (per the brief and prior rejection of the Apple reference):**
- No scroll-jacking or pinned-scroll sequences.
- No fake cursor animations.
- No excessive blur or glassmorphism.
- No gradients or decorative graphics/illustrations — depth comes from surface layering, borders, shadow, and spacing only.
- No new marketing sections beyond the one benefits section (still no "How it works," no testimonials, no logo wall, no pricing).
- No new npm dependencies — the entrance animation and demo loop are achievable with CSS `@keyframes`/transitions plus a small amount of client-side state (a `"use client"` boundary on the preview component, since it needs a timer-driven state cycle for the demo — the entrance animation itself can be pure CSS).

## Implementation approach

- `frontend/src/app/page.tsx`: restructure the hero `<section>` from PR #34's `lg:flex-row` split into a stacked layout (centered text block, then a full-width preview block below it), update headline/subhead copy, add the new benefits `<section>` below the preview, add the trust line. Container width moves from `max-w-6xl` to an explicit `max-w-[1200px]` (or equivalent) applied consistently across hero and benefits.
- `frontend/src/components/task-mock.tsx`: the demo-completion cycle is implemented as a pure CSS `@keyframes` loop (as validated in the approved mockup) — no `useState`/`useEffect`/timers, no `"use client"` boundary. This is a deliberate choice, not a placeholder: a JS-timer-driven version would need a client boundary, would need fake-timer test infrastructure to verify its states, and buys nothing a CSS animation cycling through the same three keyframe stops (steady → completing → reset) doesn't already give faithfully. `TaskMock` stays a plain server-renderable function component, same as it is today. Internal scale (padding, type sizes, row density) increases further given the much larger footprint — the PR #34 follow-up sizing tweak (never merged, see Problem section) is superseded by this pass, not something to reapply verbatim.
- No changes to `SiteHeader`, `SiteFooter`, auth, routing, or the real `/app` Daily view — same boundary as PR #34's spec.

## Non-goals

- No scroll-triggered reveal animations for the benefits section (it's simply positioned below the preview in normal document flow).
- No dynamic/live data in the preview — still a static, illustrative mock.
- No changes to the sync feature itself — the trust line is copy only.
- No A/B testing or analytics instrumentation for this redesign.

## Testing

- `task-mock.tsx`: the existing testing approach from PR #34 (smoke-level render assertions on section labels/task text, plus the `aria-hidden` root assertion) extends unchanged — the animation is pure CSS, so the DOM is static and identical regardless of animation state; no fake-timer or animation-state test infrastructure is needed.
- `page.tsx`: same rationale as PR #34 — no established server-component test precedent in this codebase; verify manually (dev server + browser, both themes, both logged-in/out CTA states) rather than inventing new test infrastructure for this task.
