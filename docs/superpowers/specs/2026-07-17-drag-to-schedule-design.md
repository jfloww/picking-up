# Drag-to-Schedule Design — Daily Timeline v3

**Date:** 2026-07-17
**Status:** Approved
**Builds on:** `2026-07-16-daily-timeline-subtasks-design.md` (merged, live at `/app` Daily view).

## Problem

Adding a task via the Daily view's quick-add always creates an untimed task, which
renders in the all-day section. That's correct per the v2 spec (quick-add is
title-only), but the only way to move a task onto the hour rail today is to open it
and type a time into the manual `<input type="time">`. That's a lot of friction for
what should be a quick "drag it to 10am" gesture, and it made the untimed-by-default
behavior read as a bug rather than a starting state.

## Goal

Let a task's time be set by dragging, in addition to (not instead of) the existing
manual time input:

1. Drag an all-day task down onto the hour rail → sets its time.
2. Drag an already-timed chip to a new position on the rail → reschedules it.
3. Drag a timed chip back up into the all-day zone → clears its time.

## Interaction model

- **Ghost + preview line.** While dragging, a lightweight ghost (the task's title)
  follows the pointer. On the rail, a preview line plus a time label (e.g. `"10:15"`)
  shows exactly where the task will land if released now.
- **Snapping.** The pointer's Y position on the rail converts to minutes-since-midnight,
  rounds to the nearest **15 minutes**, and formats back to `"HH:MM"` — the same string
  format `setTime` already validates and stores in `Task.time`. No new data field.
- **Drop targets.**
  - Over the rail → `setTime(id, snappedTime)`.
  - Over the all-day zone (the section above the rail, including its own list and the
    quick-add) → `setTime(id, undefined)`, identical to the existing "Clear" button.
- **Auto-scroll.** The rail only shows ~8 of 24 hours at once (`max-h-96` at
  `HOUR_HEIGHT = 48`px). While dragging, if the pointer nears the top or bottom edge of
  the visible rail, it auto-scrolls to reveal adjacent hours, so every hour stays
  reachable without needing to scroll first and drag second.
- **No new keyboard path needed.** The manual time input + Clear button (existing,
  unchanged) already give keyboard and screen-reader users a fully equivalent way to
  set or clear a time. Drag is a convenience layered on top, not a replacement, so the
  drag gesture itself does not need its own keyboard-operable equivalent.
- **Non-drag click behavior is unchanged.** Clicking a chip's title still opens/closes
  the expanded editor (time input, memo, subtasks, delete) exactly as today; the drag
  gesture is initiated by press-and-move on the chip, not by a separate handle.

## Overlap layout

Dragging makes same-time collisions easy to create by accident (previously only
possible by typing the same time twice). Tasks that land on the exact same snapped
time render in **side-by-side columns** spanning the rail's width, rather than
overlapping/hiding each other — the layout most calendar apps use.

- A new pure function, `layoutTimedTasks(timed: Task[]): { task: Task; column: number; columns: number }[]`,
  groups tasks by identical `time` and assigns each a column index and the total
  column count for its group. Tasks with a unique time get `column: 0, columns: 1`
  (full width, today's behavior unchanged for the common case).
- This layout is recomputed **after** a drop completes — not live during the drag
  gesture. While dragging, the rail shows only the single preview line described
  above; other chips do not reflow until the drag ends. This keeps the gesture itself
  simple and avoids a distracting live-reflow effect.

## Data & store

No schema changes. No new store actions. A completed drag calls the same
`setTime(id, time: string | undefined)` action that the manual time input already
uses (`store.tsx`, from the daily-timeline-subtasks feature) — dragging is purely a
new way to invoke existing, already-tested state logic.

## Architecture

- **`useDragToSchedule`** (new hook, reusable): encapsulates the pointer-event
  mechanics shared by both drag origins (an all-day `TaskItem` and a rail chip) —
  tracks `pointerdown`/`pointermove`/`pointerup`, computes the snapped time or
  "over all-day zone" state from pointer position relative to the rail, and calls
  back with the result. Both call sites are otherwise identical, so one hook avoids
  duplicating the pointer-tracking logic.
- **`DayTimeline`** (existing component, extended) owns: the ghost element, the
  preview line + label, the auto-scroll behavior during an active drag, and calling
  `layoutTimedTasks` to position chips (applying each task's `column`/`columns` as a
  width/offset instead of the current always-full-width `inset-x-1`).
- **`lib/times.ts`** (existing pure module, extended): gains the Y-position → snapped
  `"HH:MM"` conversion function and `layoutTimedTasks`.

## Error handling

- A drag that ends outside both the rail and the all-day zone (e.g. released over the
  Weekly cell to the side, or outside the viewport) is a no-op — the task keeps its
  original time, mirroring "drag to nowhere cancels" in most drag UIs.
- Pointer capture is released and drag state cleared on `pointerup` **and** on
  `pointercancel` (browser-initiated cancellation, e.g. a context menu or window
  blur interrupting the gesture), so a task can never get stuck mid-drag.

## Testing

Same conventions as the rest of this feature (Vitest + RTL, colocated, TDD, pinned
clock where relevant, pristine output):

- `lib/times.ts`: unit tests for the Y-to-snapped-time conversion (boundary minutes,
  rounding direction) and `layoutTimedTasks` (no overlap → single column; two/three
  tasks at the same time → correct column assignment; tasks at different times don't
  interfere with each other's grouping).
- `useDragToSchedule` / `DayTimeline`: RTL tests simulating `pointerdown` →
  `pointermove` → `pointerup` sequences for the three core paths — all-day→rail sets
  time, rail→rail reschedules, rail→all-day clears time — plus the drag-to-nowhere
  no-op case.
- **Manual browser verification** (this feature's UI feel isn't fully capturable by
  jsdom pointer-event simulation): drag smoothness, ghost/preview-line visuals,
  auto-scroll behavior near the rail edges, and the side-by-side column rendering
  with real layout/painting.

## Out of scope (this iteration)

- Dragging a task between different days (cross-view drag).
- Resizing a chip to set a duration — durations remain out of scope per the original
  daily-timeline spec; a drag only ever sets a single start time.
- Reordering the all-day list by dragging (unrelated to time-scheduling).
- Live column-reflow of other chips while a drag is still in progress.
- Any change to rollover, storage, or the task/subtask data model.
