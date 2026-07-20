# Daily Tab Redesign — Single-Day Focus

**Date:** 2026-07-20
**Status:** Approved
**Builds on:** `2026-07-17-drag-to-schedule-design.md` (merged, live at `/app` Daily view).

## Problem

Dragging a task in the Daily view can unexpectedly switch the focused day to a
neighboring one instead of just rescheduling the task within the same day.

Root cause: the Daily tab currently renders a 7-day window (`windowAround(anchor)`).
The focused day gets the full `DayTimeline`; the 6 neighboring days render as small
`PeriodCell`s with `onClick={onFocus}`, which calls `onAnchorChange(date)` and
switches the focused day. If a drag gesture's pointer ends up near one of those
neighbor cells, its `onClick` can fire, and the focused day changes mid- or
post-drag. This is a structural side effect of the peek-columns layout, not a bug
in the drag math itself (`use-drag-to-schedule.ts` is unchanged by this spec).

## Goal

Redesign the Daily tab to focus on exactly one day at a time, removing the peek
columns that cause the bug, and improve the Time Table's default scroll position
so "now" is easier to find without manual scrolling.

## Layout

The Daily tab becomes:

- **Toolbar Prev/Next** (existing, shared `ViewSwitcher` control): for the Daily
  view specifically, changes from jumping 7 days to jumping 1 day — Today ↔
  Yesterday ↔ Tomorrow. Weekly/Monthly/Yearly nav increments are unchanged.
- **Two equal-width columns**, replacing the 7-day window:
  - **Column 1 — Day**: the existing `DayTimeline` (All-day Task stacked above
    Time Table), content unchanged, just no longer surrounded by peek columns.
  - **Column 2 — Weekly Task**: the existing week-scoped `ScopeTasks` list
    (`{ kind: "week", weekStart }`, `quickAdd`), unchanged.

With the peek columns gone, there is no longer any adjacent-day element for a
stray drag to land on — the bug is resolved as a consequence of the layout
change, not a separate patch to the drag hook.

## Time Table scroll behavior

- Viewport height increases from ~8 visible hours (`max-h-96`, 384px) to a fixed
  **12 hours** (576px at the existing `HOUR_HEIGHT = 48`px scale).
- **On today**, the rail auto-scrolls so the current-time line sits vertically
  centered in that 12-hour window. This is computed once when the view mounts or
  `date` changes (same trigger as today's existing scroll-to-07:00 effect) — not
  continuously re-centered on a timer, so a manual scroll mid-session isn't
  yanked back.
  - `scrollTop = clamp(nowOffsetPx - viewportPx / 2, 0, RAIL_HEIGHT - viewportPx)`
- **On past/future dates** (no "now" line to center on), it falls back to the
  existing fixed 07:00 start.

## Data & store

No schema changes, no new store actions. Purely a layout and default-scroll
change; `setTime` and the drag hook's calls into it are untouched.

## Architecture

- **`task-calendar.tsx`**: `shiftAnchor`'s `"daily"` case changes from
  `addDays(anchor, 7 * dir)` to `addDays(anchor, dir)`.
- **`views/daily-view.tsx`**: rewritten to a 2-column equal-width grid
  (`DayTimeline` | `ScopeTasks` week), dropping the `windowAround` loop and all
  `PeriodCell` siblings.
- **`day-timeline.tsx`**: rail viewport height constant changes (8h → 12h);
  scroll-centering logic added to the existing `useEffect([date])`, branching on
  `isToday`.
- **`lib/dates.ts`**: `windowAround` becomes dead code (its only caller was
  `daily-view.tsx`) — removed, along with its tests. `weekdayOf` also becomes
  dead (its only non-test caller was the removed peek-column label logic —
  `weekly-view.tsx` indexes `DAY_LABELS` directly, not via `weekdayOf`) —
  removed too.

## Error handling

N/A — this is a layout and default-scroll change with no new user-triggerable
error paths. The existing drag-to-schedule error handling (drag-to-nowhere
no-op, pointercancel cleanup) is unchanged.

## Testing

Same conventions as the rest of this project (Vitest + RTL, colocated, pinned
clock where relevant, pristine output):

- `task-calendar.test.tsx` (or equivalent): `shiftAnchor("daily", ...)` now
  moves 1 day instead of 7.
- `day-timeline.test.tsx`: replace the "defaults the rail scroll to 07:00" test
  with two cases — today (scroll centers the now-line within the 12h viewport)
  and a non-today date (falls back to 07:00).
- `daily-view.test.tsx` (new, currently no dedicated coverage): renders exactly
  two columns for the focused day; no `PeriodCell`/neighbor-day elements exist
  in the DOM.
- `lib/dates.test.ts`: remove the now-deleted `windowAround`/`weekdayOf` tests.
- Existing drag-to-schedule tests in `day-timeline.test.tsx` and
  `use-drag-to-schedule.test.tsx` need no logic changes — the drag mechanism
  itself is untouched, only its container.
- **Manual browser verification**: confirm a drag gesture that ends near the
  Weekly Task column no longer changes the focused day (the original bug
  report), and that the 12-hour centered scroll feels right on a real viewport.

## Out of scope (this iteration)

- Any change to `use-drag-to-schedule.ts` itself — the drag mechanics, snapping,
  and click-suppression logic are unaffected.
- Mobile/narrow-viewport responsive stacking of the two columns (follow existing
  Tailwind patterns if/when this becomes a problem; not addressed here).
- A month/year mini-view or notes section — considered and dropped; the Daily
  tab stays scoped to Day + Weekly Task, matching the user's confirmed 3-section
  concept (All-day Task and Time Table are one stacked column, not split).
- Continuous re-centering of the now-line during an active session (e.g. on a
  timer) — only computed on mount/date-change.
