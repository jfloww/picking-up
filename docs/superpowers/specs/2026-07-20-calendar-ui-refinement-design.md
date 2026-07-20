# Calendar UI Refinement Design

**Date:** 2026-07-20
**Status:** Approved
**Builds on:** `2026-07-20-daily-tab-redesign-design.md`,
`2026-07-20-weekly-task-rollup-design.md` (both merged, live at `/app`).

## Problem

Four issues with the current Daily/calendar UI, raised together but
independent in cause:

1. Untimed ("no time") tasks sit in the All-day zone, which renders above
   the hour rail — visually "at the top" of the Day column, which reads as
   undesirable prominence for tasks that haven't been scheduled yet.
2. `/app`'s outer page can grow taller than the viewport and the browser
   scrolls the whole page (visible as a right-edge scrollbar on the window
   itself), rather than only the calendar content scrolling within its own
   region.
3. Task rows (title text, row height) are visually small and easy to miss
   next to the hour rail's 24 gridlines and the empty space between them —
   the timeline structure currently competes with, rather than supports,
   the tasks it's meant to organize.
4. Task text contrast/weight doesn't stand out enough from secondary
   metadata (time badges, gridlines) to read as the primary content.

## Goal

Fix all four without changing the app's overall layout/navigation
structure (same views, same toolbar, same drag-to-schedule mechanics, same
color tokens) — this is a refinement pass, not a redesign.

## Changes

### 1. All-day zone moves below the rail

In `DayTimeline`, swap render order: the hour rail (Time Table) renders
first, the All-day section renders after it. No change to either section's
internal content, quick-add, or drag-to-schedule behavior (all-day↔rail
dragging keeps working identically) — purely a reorder.

### 2. Page never scrolls; `main` is the one scroll container

In `app/app/page.tsx`, the outer wrapper changes from `min-h-svh` (grows
past the viewport, causing the browser to scroll the whole page) to a fixed
`h-svh overflow-hidden`. `main` (already `flex-1`) gains `min-h-0
overflow-y-auto`, making it the single scrollable region: header and
footer stay fixed, and all calendar content scrolls within `main` when it
overflows. The hour rail's existing internal 12-hour scroll region is
unrelated and unchanged — it keeps its own nested scrollbar exactly as
today.

### 3. Task rows get bigger and bolder

In `TaskItem` (the single component every task row in the app renders
through — All-day zone, rail chips, Weekly Task list, Weekly/Monthly view
cells):
- Title: `text-sm` → `text-base`, add `font-medium`. The weight change is
  what actually delivers "improve text contrast" — the title already
  renders at full foreground-color contrast, so what was missing is visual
  weight, not color.
- Collapsed row: add `py-1.5` vertical padding (today the row has none,
  sized only by the checkbox and text line-height).
- Time and date-label badges (`text-xs`) are unchanged — they stay
  secondary so the title remains the dominant element.

### 4. Timeline gridlines get quieter

In `DayTimeline`, the hour gridlines change from `border-border/40` to
`border-border/15` — still present for orientation, pulled back visually
so bigger/bolder task rows read as the dominant content instead of
competing with 24 evenly-weighted lines.

## Data & store

No changes. Purely layout/CSS and JSX-order changes to existing components;
no new props, no store/data model changes.

## Testing

- `day-timeline.test.tsx`: existing tests use `data-testid` lookups and
  mocked `getBoundingClientRect` per element, not DOM order, so the
  All-day/rail reorder needs no test changes — confirmed by inspection, no
  test currently asserts relative order between `all-day-zone` and
  `hour-rail`. Add one test confirming the rail renders before the All-day
  section in document order (`compareDocumentPosition` or query-order
  assertion), to lock in the new order intentionally rather than leave it
  implicit.
- No test currently pins `TaskItem`'s `text-sm` class, so the typography
  change needs no existing-test updates. No new test is needed for a pure
  Tailwind class change with no behavioral effect.
- No automated test practically covers page-level (browser/`html`) scroll
  behavior under jsdom (jsdom has no real layout/viewport engine) — this is
  a manual browser verification item.

## Out of scope (this iteration)

- Any change to drag-to-schedule mechanics, snapping, or the hour grid's
  15-minute resolution.
- Any change to color tokens, spacing scale, or other components not named
  above (QuickAdd, ViewSwitcher, PeriodCell, ScopeTasks's compact rendering
  stay as-is — compact mode is deliberately terse per the weekly-rollup
  spec and isn't part of "the main Todo/calendar UI" this pass targets).
- Bounding/scrolling individual sub-regions (e.g. giving the Weekly Task
  column its own nested scrollbar) — `main` becoming the single scroll
  container is sufficient and simpler; only revisit per-region scrolling if
  a specific region's growth becomes a problem in practice.
- Responsive/mobile-specific layout changes.
