# Daily Agenda: Done Today Transition Animation

**Date:** 2026-08-05
**Status:** Approved

## Problem

`DayAgenda` (`day-agenda.tsx`) renders three sections — "All Day To-Do",
"Next Up", "Done Today" — each derived by filtering the same `tasks` array
every render (lines 43-47). When a task's `done` flag flips, it disappears
from its old section and appears in "Done Today" on the very next render,
with no transition. The existing `--animate-task-complete` pop
(`task-item.tsx`'s `DONE_CHECKBOX_CLASS`) only animates the checkbox
itself — the card's move between sections is an instant, hard cut.

## Goal

When a task is checked or unchecked, its card fades/slides out of its
current section and fades/slides into its new section, instead of
snapping instantly. Applies to Daily view only.

## Scope decisions (brainstormed and approved)

- **Daily view only.** Weekly's card view is out of scope for this pass.
- **No new dependency.** Plain CSS `@keyframes` + Tailwind `--animate-*`
  tokens, following the existing `--animate-task-complete` convention in
  `globals.css` — not framer-motion or another animation library.
- **Not a true cross-section FLIP/shared-element flight.** The three
  sections are separate, unconnected DOM subtrees today; making a card
  visually travel from "Next Up" to "Done Today" would require a much
  larger restructure (shared layout root, position measurement). Instead,
  each section independently plays an exit or enter animation in place.
- **Persistence is not delayed.** `toggleTask`'s store update and
  `repo.update(...)` API sync (`store.tsx:259-269`) fire immediately on
  toggle, unchanged. Only the *rendering* of section membership is
  delayed, so a slow network or reload never leaves a card stuck
  mid-animation.
- **Undo is symmetric.** Unchecking a "Done Today" task plays the same
  exit/enter pair moving it back to "All Day To-Do" or "Next Up"
  (whichever the task belongs to based on `time`).
- **Only genuine transitions animate.** Tasks already marked done when
  the page loads must not play an enter animation on mount — only a
  `done` change that happens while the component is mounted triggers the
  animation.

## Animation vocabulary

Two new keyframes in `globals.css`, alongside `task-complete-pop`:

```css
--animate-task-exit: task-exit 260ms ease-in both;
--animate-task-enter: task-enter 260ms ease-out both;
```

```css
@keyframes task-exit {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
}

@keyframes task-enter {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

260ms, matching the existing `task-complete-pop` duration's order of
magnitude. `both` fill mode so the card holds its start/end state outside
the animation window instead of flashing back.

## State/timing mechanism

A new hook, `useTaskTransitionClasses(dayTasks: Task[])`, local to
`day-agenda.tsx`:

- Keeps a `ref` of each task id's previous `done` value.
- On a render where a task's `done` value differs from its previous
  value, and this isn't the initial mount, it:
  - Immediately records the task's *old* section (`"todo" | "done"`
    based on the previous `done` value) in a `transitions` state map,
    tagged `exit`.
  - Starts a 260ms timer. When it fires, flips the tag to `enter`
    (already rendering in the new section by then, since the real filter
    in `day-agenda.tsx` uses live `task.done`) and starts a second timer
    that clears the entry after another 260ms.
- Re-toggling a task while its previous transition is still in flight
  cancels the old timers and restarts from the task's current state — no
  stuck or duplicate animations.
- All timers are cleared on unmount.

`renderCard` reads this map and applies `animate-task-exit` /
`animate-task-enter` / nothing to the card's outer wrapper
(`day-agenda.tsx:91`) accordingly.

Because the "old section" is only needed to decide *which* section keeps
rendering a card mid-exit, the three section filters
(`allDayToDo`/`nextUp`/`doneToday`, `day-agenda.tsx:43-47`) gain one
extra condition each: a task also renders in its *previous* section while
its transition entry is tagged `exit`, in addition to the normal
`done`/`!done` + `time` filter.

## Non-goals

- No shared-element/FLIP flight between sections.
- No change to Weekly, Monthly, or Bucket List views.
- No change to `toggleTask`'s persistence timing or the
  `--animate-task-complete` checkbox pop.
- No height/layout-collapse animation for sibling cards closing the gap
  left behind — they reflow instantly, same as today.

## Testing

- Manual, in-browser only (visual/timing behavior, no existing animation
  tests elsewhere in this codebase to extend):
  - Check an "All Day To-Do" task: confirm it fades/slides out in place,
    then the "Done Today" copy fades/slides in ~260ms later.
  - Check a "Next Up" task: same, returning to the correct section on
    undo (`time`-based vs. all-day).
  - Uncheck a "Done Today" task: mirrored animation back to its original
    section.
  - Rapid click a checkbox several times: no stuck, duplicated, or
    visually glitched cards.
  - Reload the page with some tasks already done: "Done Today" renders
    with no enter animation on initial mount.
