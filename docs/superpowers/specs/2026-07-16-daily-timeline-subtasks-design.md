# Daily Timeline & Subtasks Design — Task Calendar v2

**Date:** 2026-07-16
**Status:** Approved
**Builds on:** `2026-07-16-task-calendar-design.md` (merged). Visual reference: iPad
Calendar app (day view) — not the iPhone layout.

## Goals

1. Rebuild the **Daily view** around a centered, enlarged "today" box containing a
   00:00–23:59 time axis.
2. Give tasks an **optional start time**.
3. Give tasks **one level of subtasks** ("a task in a task": general task + details).

Everything else from v1 (view hierarchy, fading, rollover, storage seam) is unchanged
unless stated here.

## Daily view (rebuilt)

- **Rolling window, focused day centered.** Seven day cells: the anchor day in the
  middle, three neighbors on each side, crossing week and month boundaries freely
  (e.g. `13 14 15 [16] 17 18 19`). Neighbor cells are faded/compact (PeriodCell
  pattern) and clickable to refocus. `‹ ›` pages the anchor by ±7 days; **Today**
  recenters on the current date.
- **The focused center box is visually dominant** — roughly twice a neighbor's
  width, full opacity, highlighted like other focused cells. It contains:
  - **All-day section** (top): untimed tasks for that day + the quick-add input.
  - **Hour rail** (below): 00:00–23:59 with hour lines and labels. Tasks with a
    `time` render as chips positioned at their hour, ordered by time. When the
    focused day is today, a **"now" indicator line** sits at the current time.
    The rail scrolls vertically inside the box; on mount it is scrolled so early
    morning hours are not the first thing visible (default scroll ≈ 07:00).
- **Weekly cell** stays pinned at the right edge, always bound to the *focused
  day's* week (`weekStartOf(anchor)`), editable with quick-add — rolled-over tasks
  remain visible from Daily view.
- Header shows the focused day (e.g. "Thursday, July 16") instead of only the month.

Other views (Weekly/Monthly/Yearly) keep their v1 layouts.

## Task time

- `Task.time?: "HH:MM"` (24-hour, zero-padded, e.g. `"09:30"`). Optional; meaningful
  for day-scoped tasks. Ordering and comparison by plain string comparison — same
  discipline as date keys. No end time or duration in this version.
- **Editing:** the expanded task editor gains a time input (settable and clearable).
  Quick-add remains title-only.
- **Display:** in the Daily hour rail, a timed task is a chip at its hour. In all
  other task lists (weekly day cells, weekly/monthly side cells, compact previews),
  a timed task shows its time as a prefix: `14:00 · Dentist`.
- Rollover keeps `time` untouched; a day task rolled into a Weekly cell still shows
  its time prefix.
- Within any day's list: timed tasks first (ascending by time), then untimed, each
  group in insertion order.

## Subtasks

- `Task.subtasks?: Subtask[]` where `Subtask = { id: string; title: string; done: boolean }`.
  **One level deep** — subtasks cannot contain subtasks. Subtasks have no scope,
  no memo, no time; they belong to their parent and move with it (rollover moves
  the parent + subtasks as one unit).
- **Completion is independent.** Each subtask has its own checkbox; the parent's
  checkbox is checked manually. No auto-completion in either direction.
- **Progress badge:** wherever a collapsed task with subtasks renders (including
  compact previews), it shows `done/total` (e.g. `2/5`).
- **Editing:** the expanded task editor shows the subtask list — checkbox + title
  per row, delete per row, and an "add subtask" input. Blank titles ignored
  (same trim rule as tasks).

## Data model changes

```ts
interface Subtask {
  id: string;      // crypto.randomUUID()
  title: string;
  done: boolean;
}

interface Task {
  // ...v1 fields unchanged...
  time?: string;        // "HH:MM", 24h zero-padded
  subtasks?: Subtask[];
}
```

- Storage key stays `picking-up.tasks.v1` — the new fields are optional and
  additive, so existing stored data loads unchanged (no migration).
- The read path **normalizes instead of rejecting** for the new fields: an
  invalid `time` (not matching `/^\d{2}:\d{2}$/`) is cleared to `undefined`; a
  non-array `subtasks` is dropped; malformed subtask entries (missing string
  `id`/`title` or boolean `done`) are filtered out. The task itself is kept —
  only v1's structural validation (`isTask`/`isScope`) can drop a whole task.

## Store & architecture changes

- New store actions (context + reducer, same optimistic dispatch + fire-and-forget
  persist pattern): `setTime(id, time: string | undefined)`,
  `addSubtask(id, title)`, `toggleSubtask(id, subtaskId)`,
  `removeSubtask(id, subtaskId)`.
- New pure module `lib/times.ts`: `isValidTime(value)`, `nowTime()` (current
  "HH:MM"), `timeToMinutes(time)` (for chip positioning), plus a
  `compareTasksForDay(a, b)` helper used by day lists (timed-by-time first, then
  untimed).
- `lib/dates.ts` gains `windowAround(anchor, radius = 3): string[]` (7 consecutive
  date keys centered on the anchor) and `dayLabel(dateKey)` for the Daily header.
- New components: `DayTimeline` (hour rail + chips + now line + all-day section),
  `SubtaskList` (inside the TaskItem expansion). `TaskItem`'s expansion grows the
  time input; its collapsed row grows the time prefix and progress badge.
- `DailyView` is rebuilt on `windowAround`; `DAY_LABELS` still labels columns
  (index derived from each date's weekday, since the window no longer starts on
  Sunday).

## Error handling

- Invalid `time` strings are rejected at the input (validation) and filtered at the
  storage boundary (`isTask`) — a bad stored `time` clears to undefined rather than
  dropping the task.
- The now-line and default scroll are presentation-only; clock reads go through
  `nowTime()`/`todayKey()` so tests can pin them.

## Testing

Same conventions as v1 (Vitest + RTL, colocated, TDD, pinned clock via
`toFake: ["Date"]`, pristine output):

- `lib/times.ts` and `windowAround` unit tests (boundaries: midnight, month/year
  crossing windows).
- Repository round-trip + validation for `time`/`subtasks` (including malformed
  subtask filtering and bad-time clearing).
- Store tests for the four new actions.
- `DayTimeline`/`DailyView` tests: window centering, refocus clicks, timed chip
  placement, all-day section, now-line only on today.
- `TaskItem` tests: time editing, subtask add/toggle/delete, progress badge.

## Out of scope (this iteration)

- Durations / end times, drag-to-schedule, drag-and-drop
- Nested subtasks beyond one level; subtask memos/times
- Auto-completion between parent and subtasks
- Changes to Weekly/Monthly/Yearly layouts (beyond the time prefix + badge)
- Django persistence (seam unchanged)
