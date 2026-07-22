# Daily Tab Agenda Redesign

**Date:** 2026-07-22
**Status:** Approved
**Related:** `2026-07-20-daily-tab-redesign-design.md` (the current 2-column layout this
builds on), `2026-07-22-weekly-tab-redesign-design.md` (the Weekly tab's day boxes,
which become the new home for "everything unfinished this week" once this spec
removes that list from the Daily tab).

## Problem

The Daily tab (`daily-view.tsx` + `day-timeline.tsx`) currently splits the left
column into two stacked zones via an internal `ShrinkStack`: an "All-day" zone
(untimed tasks + its own quick-add) sits above the hour-rail (the 24h timeline
with timed task chips). The right column shows a "Weekly" list — every
unfinished task for the week, day-scoped or week-scoped, each dated — with its
own quick-add, swapping to the task detail panel when a task is selected.

The ask: simplify the left column to just the timeline, and repurpose the
right column to show *today's* full task list (instead of the week's), styled
as large, readable cards instead of compact rows.

## Goal

- Left column: only the hour-rail. No all-day zone, no quick-add up there.
- Right column: relabeled "All day" (from "Weekly"), showing every task for
  the anchored day — timed and untimed — in time order (untimed after timed,
  same rule already used elsewhere), rendered as big single-line cards with a
  ~1.5x-larger title. Quick-add stays, pinned at the bottom.
- Drag-to-schedule (dragging a task between "untimed" and a specific time)
  keeps working, now spanning the two columns instead of one internal split.
- The Daily tab's week-level task list is dropped entirely — it's superseded
  by the Weekly tab's own day boxes (see the related weekly-tab spec), which
  already show the same "everything unfinished this week" information.

## Layout

```
┌─────────────────────┐  ┌─────────────────────────┐
│                      │  │  ALL DAY                │
│                      │  │  ┌───────────────────┐  │
│      hour-rail       │  │  │ ☐ Team standup 9:00│  │
│   (unchanged visual  │  │  ├───────────────────┤  │
│    timeline, chips)  │  │  │ ☐ Water plants     │  │
│                      │  │  ├───────────────────┤  │
│                      │  │  │ ☐ Review PR   2:30 │  │
│                      │  │  └───────────────────┘  │
│                      │  │  + Add task              │
└─────────────────────┘  └─────────────────────────┘
```

- Left card keeps its current outer styling (`bg-card ring-1 ring-ring/40`),
  now containing only the hour-rail directly — no internal `ShrinkStack`
  (nothing left to shrink for; the rail fills the card).
- Right panel keeps its current outer styling (`bg-muted/40`), section label
  changes from "Weekly" to "All day". Its existing swap-to-detail-panel
  behavior (via `ShrinkStack`, unchanged) still applies when a task is
  selected — only what swaps *in* as the primary content changes, from the
  week list to the new day-agenda list.
- Task cards are ~1.5x the current row's title size (16px → 24px, i.e.
  `text-base` → `text-2xl`) — bigger padding, a visible card background/ring
  distinct from the panel, checkbox scaled up modestly to match. This
  applies **only** to the right-side agenda cards — the timeline's chips
  (left column) stay their current compact size, since they need to fit
  inside hour-slot height.
- Layout within a card: checkbox, then the (now-big) title, then the time on
  the right (blank if untimed) — the reverse order from today's compact row,
  which puts time *before* the title. Subtask-count badge / repeat pill /
  rolled-over icon stay, appended after the time, same as today just at the
  larger scale.

## What moves, what's removed

- The "All-day" zone's content (untimed tasks) and the hour-rail's timed
  chips are no longer two separate rendered lists — they become one, sorted
  list on the right (agenda), while the left keeps showing timed tasks as
  positioned chips on the rail (that visual doesn't change; a task can now
  appear in two places at once: as a chip on the timeline **and** as a card
  in the agenda — that's intentional, mirroring how many calendar apps pair
  a visual timeline with a scannable agenda).
- The right column's week-level rollup list is removed from the Daily tab
  entirely. It's not replaced by anything in this tab — that information now
  lives in the Weekly tab's day boxes (which, per the related spec, already
  surface exactly "this day's tasks including same-week rollovers" per box).
  A user who wants to see the rest of the week's backlog uses the Weekly tab.

## Drag-to-schedule across two columns

`use-drag-to-schedule.ts`'s gesture logic (pointer capture, hit-testing via
`getBoundingClientRect` on two zone refs, auto-scroll, click-suppression) does
**not need to change** — it already resolves drop targets purely by
comparing pointer coordinates against two ref'd elements' bounding rects, with
no assumption about where those elements sit in the DOM tree. The only change
is *who owns the hook call*: today `DayTimeline` calls
`useDragToSchedule({ railRef, allDayZoneRef, ... })` itself, holding both refs
locally. Since the rail (left) and the drop-to-clear-time zone (right,
formerly the all-day zone, now the whole agenda list) become siblings in two
different components, the hook call moves up to their common parent
(`DailyView`), which then:

- Owns `railRef` and a new `agendaZoneRef` (the direct replacement for
  today's `allDayZoneRef` — same "drop here to clear time" role, just
  labeling the agenda list's container instead of the old all-day zone's).
- Passes `railRef` and `getDragHandlers` down into `DayTimeline` (which no
  longer creates its own ref or calls the hook itself).
- Passes `agendaZoneRef` and `getDragHandlers` down into the new agenda
  component, which wraps each card the same way `DayTimeline` currently wraps
  each chip/all-day row — a wrapper `<div {...getDragHandlers(id, title)}>`
  around the card.
- Renders the drag-ghost overlay (today rendered inside `DayTimeline`) once,
  at the `DailyView` level — it's `position: fixed` already, so this is a
  pure relocation, not a visual change.

## New component: the day agenda

A new component (name and exact file left to the implementation plan, e.g.
`day-agenda.tsx`) renders the right column's list: every task for the
anchored day (timed + untimed) sorted via the existing `compareTasksForDay`
(timed ascending by time, untimed after, stable order among themselves),
each as a `TaskItem` in its new large-card presentation, wrapped in a
drag-handler div, plus a quick-add pinned at the bottom that adds a new
day-scoped task. It receives `onSelectTask` (wired to the same
selection state `DailyView` already uses for the detail-panel swap) and the
drag refs/handlers described above.

`ScopeTasks` is **not** reused for this list — it doesn't support per-item
drag-handler wrapping, and its existing "week, excluding this day" query is
the opposite of what's needed here (every one of *this* day's tasks, full
stop). The new component owns its own simple query (filter `tasks` by
`scope.kind === "day" && scope.date === date`, then sort).

## `TaskItem` size variant

Rather than building a separate presentational component for the big cards
(which would duplicate `TaskItem`'s toggle/expand/subtask/repeat-pill/rolled
-over logic), `TaskItem` gains an optional `size?: "default" | "large"` prop
(default `"default"`, so every other caller — the timeline chips, the old
month/year previews via `ScopeTasks` — is visually unchanged). When
`"large"`: bigger title text and padding, a visible card background/ring, and
the title-before-time layout swaps to title-then-time. Existing behavior
(`highlight`, `repeatLabel`, `onSelect` vs. inline-expand, subtasks, rolled
-over icon) all continue to work identically, just at the larger scale and
reordered layout.

## Testing considerations

- `day-timeline.test.tsx` currently tests both the rail *and* the all-day
  zone *and* the drag interaction between them, all as one component in
  isolation. Once the all-day zone and drag ownership move out of
  `DayTimeline`, most of that file's drag-related tests move to wherever the
  new agenda component and `DailyView` are tested — `DayTimeline` alone will
  only have the rail to test (chip placement, now-line, scroll behavior).
- `daily-view.test.tsx`'s existing "shows the day's timeline and the week's
  task list side by side" and the Weekly-column-specific tests no longer
  apply (the week list is gone) and get replaced with agenda-list assertions
  (label "All day", one quick-add at the bottom, big-card rendering, time
  ordering with untimed after timed).
- The exact test-by-test migration (what moves, what's deleted, what's new)
  is left to the implementation plan — this is a bigger restructuring than a
  single new prop, and warrants task-by-task planning the way the Weekly tab
  redesign did.

## Out of scope (this iteration)

- Any visual change to the timeline itself (chip size, hour markings,
  now-line, drag-preview line) — explicitly staying compact.
- Any change to `TaskDetailPanel` or `TaskDetailFields` — reused exactly as
  today.
- A dedicated place to see backlog from *other* days once it's off the Daily
  tab — the Weekly tab's day boxes are considered sufficient for now; revisit
  only if it turns out people lose track of it in practice.
- Any change to the Weekly or Monthly/Yearly tabs themselves.
