# All-day Zone Above the Rail Design

**Date:** 2026-07-21
**Status:** Approved
**Builds on:** `2026-07-21-daily-timetable-shrink-to-fit-design.md` (merged into
this branch, not yet merged to `main`).

## Problem

`2026-07-20-calendar-ui-refinement-design.md` moved the All-day zone to
render below the hour rail, reasoning that untimed tasks sitting "at the
top" of the Day column read as undesirable prominence. Now that the rail
shrinks to fit the All-day zone's content (previous spec in this branch),
the user wants the All-day zone back at the top of the Day column instead —
an explicit, informed reversal of that earlier ordering decision, not an
oversight.

## Goal

All-day zone renders above the hour rail. The rail's shrink-to-a-6h-floor
behavior (from the previous spec in this branch) is unaffected — only the
visual position of the two panes swaps.

## Changes

### 1. `ShrinkStack` gains a `secondaryFirst` prop

`frontend/src/components/shrink-stack.tsx`: add an optional prop
`secondaryFirst?: boolean` (default `false`, preserving current behavior
for any other future caller). When `true`, the component renders
`secondary` before `primary` in the JSX/DOM instead of the current
`primary`-then-`secondary` order.

This changes actual DOM order (not just visual position via CSS `order`),
so tab order and screen-reader reading order match what's on screen. No
other behavior changes: `primary` keeps its `minHeight`/`maxHeight` shrink
bounds, `secondary` keeps its `calc()` cap and relies on its own internal
scroll region exactly as today; `data-testid="shrink-stack-primary"` and
`"shrink-stack-secondary"` keep referring to the same panes as today
(rail = primary, All-day zone = secondary) — only their position swaps.

### 2. `DayTimeline` passes `secondaryFirst`

`frontend/src/features/tasks/components/day-timeline.tsx`: pass
`secondaryFirst` to the existing `ShrinkStack` call. No other prop
changes — `primaryMinHeight`/`primaryMaxHeight` stay as-is, so the rail
still shrinks toward its 6h floor as All-day tasks are added; it now just
displays below the All-day zone instead of above it.

## Data & store

No changes.

## Testing

- `shrink-stack.test.tsx`: add a test asserting that with
  `secondaryFirst={true}`, the `shrink-stack-secondary` element precedes
  `shrink-stack-primary` in document order (via
  `compareDocumentPosition`), and that the default (`secondaryFirst`
  omitted/`false`) keeps today's primary-first order.
- `day-timeline.test.tsx`: the existing test
  `"renders the hour rail before the All-day section"` currently asserts
  rail-before-All-day; flip its assertion (and ideally its name) to
  assert All-day-before-rail, since that's the new intentional order.

## Out of scope (this iteration)

- Any change to the rail's shrink/floor values or the All-day zone's
  internal scroll behavior — both are unchanged, only reordered.
- Applying `secondaryFirst` anywhere else — no other `ShrinkStack`
  consumer exists yet.
