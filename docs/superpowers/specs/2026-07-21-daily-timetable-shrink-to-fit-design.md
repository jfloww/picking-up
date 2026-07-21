# Daily Timetable Shrink-to-Fit Design

**Date:** 2026-07-21
**Status:** Approved
**Builds on:** `2026-07-20-calendar-ui-refinement-design.md`,
`2026-07-20-daily-tab-redesign-design.md` (both merged, live at `/app`).

## Problem

In `DayTimeline` (Daily tab), the hour rail (Time Table) and the All-day
zone below it (where the "add task" QuickAdd input lives) size themselves
independently and are unaware of each other:

- The rail is capped at a hardcoded `style={{ maxHeight: VIEWPORT_HEIGHT }}`
  (576px, 12 hours), always.
- The All-day zone is capped at a hardcoded `max-h-32` (128px), always.

Their combined footprint (576 + gap + 128px) is a fixed assumption that
doesn't account for the container's real available height. As tasks are
added to the All-day zone and it needs more room, neither panel adjusts —
the result is an unwanted scrollbar appearing on the outer Day column
("the whole section") instead of the intended per-panel scroll behavior
established in `2026-07-20-calendar-ui-refinement-design.md` §2.

## Goal

As tasks are added below the time table, the time table shrinks to make
room — down to a floor of half its full height (288px / 6h). Once the rail
hits that floor, further growth is absorbed by the All-day zone's own
existing internal scroll (already scoped to just the task rows, not the
"All-day" label or the QuickAdd input, which stay pinned and visible).
The outer Day column itself must never need to scroll.

## Changes

### 1. New component: `ShrinkStack`

`frontend/src/components/shrink-stack.tsx` — a small, generic layout
primitive: a flex column of two panes where the first pane (`primary`)
shrinks to make room for the second (`secondary`), bounded by a min/max
height, and the second pane caps its own growth so it never exceeds the
container instead of overflowing it.

```tsx
type ShrinkStackProps = {
  primary: React.ReactNode;
  primaryMinHeight: number; // px floor
  primaryMaxHeight: number; // px ceiling
  secondary: React.ReactNode;
  gap?: number; // px, default 6 (matches gap-1.5)
};
```

Implementation (pure CSS flexbox, no JS measurement, no
`ResizeObserver`):
- Wrapper: `flex h-full min-h-0 flex-col`, `gap: {gap}px`.
- `primary` wrapper: `flex-1`, inline `minHeight`/`maxHeight` from props,
  `overflow-y-auto` (unchanged behavior — already scrolls internally when
  its own content exceeds 12h).
- `secondary` wrapper: `flex-shrink-0`, inline
  `maxHeight: calc(100% - {primaryMinHeight}px - {gap}px)`.

Flexbox's own shrink algorithm does the rest: `primary` (flex-1) absorbs
the shrink first and stops at its CSS `min-height` floor; `secondary`
(flex-shrink-0) is content-sized up to its `calc()` cap, then whatever
content it holds beyond that cap scrolls via its own existing internal
`overflow-y-auto` — unchanged from today.

This component is generic (two slots + numeric props) so a future page
needing the same "shrink-then-scroll" behavior can reuse it directly,
without a wider redesign now for pages that don't exist yet.

### 2. `DayTimeline` uses `ShrinkStack`

In `frontend/src/features/tasks/components/day-timeline.tsx`:
- Remove the rail's hardcoded `style={{ maxHeight: VIEWPORT_HEIGHT }}`.
- Remove the All-day zone wrapper's hardcoded `max-h-32`.
- Wrap the rail (`primary`) and the All-day zone (`secondary`) in
  `ShrinkStack`, passing `primaryMinHeight={VIEWPORT_HEIGHT / 2}` (288),
  `primaryMaxHeight={VIEWPORT_HEIGHT}` (576).
- `HOUR_HEIGHT`/`VIEWPORT_HEIGHT` constants and the All-day zone's internal
  structure (label, scrollable task rows, pinned `QuickAdd`) are otherwise
  unchanged.

## Data & store

No changes. Purely a new layout component plus wiring it into
`DayTimeline`; no new props on task/data types, no store changes.

## Testing

- New `shrink-stack.test.tsx`: verify the computed inline styles
  (`minHeight`/`maxHeight` on `primary`, `maxHeight` calc string on
  `secondary`) render as expected for given props — this is what jsdom can
  actually assert, since it has no real layout engine to verify the visual
  shrink behavior.
- `day-timeline.test.tsx`: update any test currently asserting the rail's
  old fixed `maxHeight: 576` inline style to instead assert
  `ShrinkStack`/`min`/`max` props are passed correctly (288/576).
- Manual browser verification: add enough All-day tasks to observe the
  rail visibly shrink toward 288px, then confirm task rows (not the
  QuickAdd input) start scrolling internally once the rail is at its
  floor, with no scrollbar appearing on the outer Day column.

## Out of scope (this iteration)

- Applying `ShrinkStack` to any other page/panel (e.g. the Weekly Task
  column) — no concrete second use case exists yet; revisit when one does.
- Animating the shrink transition.
- Any change to drag-to-schedule mechanics, the hour grid's 15-minute
  resolution, or now-centering scroll logic.
- Responsive/mobile-specific layout changes.
