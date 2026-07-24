# Detach a Task Occurrence from Its Routine

**Date:** 2026-07-24
**Status:** Approved

## Problem

A "routine" anchor task (one with `repeatWeekdays` set) spawns a fresh task
instance each matching day via `materializeRoutines`
(`frontend/src/features/tasks/lib/routines.ts`), stamping the spawned
instance's `repeatSourceId` with the anchor's id. Once a task has
`repeatSourceId` set, `TaskDetailFields` renders a static, non-interactive
"Part of a routine" label (`task-detail-fields.tsx:77-81`) instead of the
weekday repeat picker. There is currently no way to detach a single day's
occurrence from its routine — the only options are editing the anchor
(which changes the whole routine going forward) or deleting the occurrence
outright.

## Goal

Let a user turn one routine occurrence into a standalone task without
deleting it, from both places `TaskDetailFields` renders: the slide-in
drawer (`task-detail-drawer.tsx`) and the inline expanded row on the
calendar (`task-item.tsx`).

## Behavior

- Detaching clears `repeatSourceId`. The task becomes a plain, non-repeating
  task by default — it does **not** inherit the anchor's weekdays.
- Once detached, the weekday repeat picker becomes available on that task
  (same picker the anchor uses), so the user can optionally give it its own
  independent repeat schedule in the same interaction, if they choose to.
- Detaching does not touch the anchor task or any other occurrence.

## Design

### Store action

Add one action to `TasksContextValue` in `store.tsx`, following the existing
per-field action pattern (`setPriority`, `setRepeatWeekdays`, etc.):

```ts
detachFromRoutine(id: string, weekdays?: number[]): void
```

Implementation mirrors `setRepeatWeekdays`, but also clears
`repeatSourceId`:

```ts
detachFromRoutine(id, weekdays) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current) return;
  const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
  const task: Task = { ...current, repeatSourceId: undefined, repeatWeekdays: normalized };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
```

Both `repeatSourceId` and `repeatWeekdays` are set in the same dispatched
update. See "Why one combined action" below for why this matters.

### `TaskDetailFields` (`task-detail-fields.tsx`)

New prop: `onDetachFromRoutine: () => void`.

The "Part of a routine" branch gains a small text-button next to the
existing label, styled as a subtle inline link (matching the visual weight
of the existing "Delete" link elsewhere in this component, but not
destructive-colored):

```tsx
{task.repeatSourceId !== undefined ? (
  <span className="flex items-center gap-1 text-xs text-subtle">
    <RotateCw aria-label="Part of a routine" className="size-3" />
    Part of a routine
    <button
      type="button"
      onClick={onDetachFromRoutine}
      className="text-subtle underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      Detach
    </button>
  </span>
) : (
  <TaskRepeatPicker ... />
)}
```

This is the only change needed inside `TaskDetailFields` — both call sites
(drawer and inline row) get the button automatically.

### Inline row (`task-item.tsx`) — immediate commit

Matches how every other field already behaves in this component (no
buffering exists here at all):

- `TaskItemActions` gains `detachFromRoutine: (id: string, weekdays?: number[]) => void`.
- `taskItemHandlers()` gains `onDetachFromRoutine: (weekdays?: number[]) => actions.detachFromRoutine(id, weekdays)`.
- `TaskItem` passes `onDetachFromRoutine` straight through to `TaskDetailFields`.

Because `taskItemHandlers()` is spread onto both `TaskItem` and
`TaskDetailDrawer` at their call sites (`daily-view.tsx`, `weekly-view.tsx`),
no changes are needed in the view files — both consumers get the same
handler shape, and each interprets it according to its own commit timing
(see below).

### Drawer (`task-detail-drawer.tsx`) — buffered until Done

Per the existing buffered-edit pattern (`Draft` state, committed only on
Done; discarded on Cancel/X/Escape):

- `Draft` gains `detached: boolean`, defaulting to `false` in
  `draftFromTask`.
- The drawer's own (local, no-arg) `onDetachFromRoutine` passed into
  `TaskDetailFields` just flips the flag: `() => setDraft((d) => ({ ...d, detached: true }))`.
- `draftTask` (currently `{ ...task, ...draft }`) additionally overrides
  `repeatSourceId: draft.detached ? undefined : task.repeatSourceId` so the
  UI swaps to the weekday picker immediately, before Done is clicked.
- `handleDone` replaces the existing unconditional weekdays-changed check
  with:

  ```ts
  const original = task.repeatWeekdays ?? [];
  const weekdaysChanged =
    draft.repeatWeekdays.length !== original.length ||
    draft.repeatWeekdays.some((d, i) => d !== original[i]);

  if (draft.detached) {
    onDetachFromRoutine(weekdaysChanged ? draft.repeatWeekdays : undefined);
  } else if (weekdaysChanged) {
    onRepeatWeekdaysChange(draft.repeatWeekdays);
  }
  ```

  The drawer's outer `onDetachFromRoutine` prop (received from its parent,
  same shape as the store action: `(weekdays?: number[]) => void`) is
  satisfied by the `taskItemHandlers()` spread described above — no new
  prop threading needed in `daily-view.tsx` / `weekly-view.tsx`.

### Why one combined action, not two dispatches

`store.tsx`'s action creators all close over the same `state` from the
render that produced them (`useMemo(..., [state, repo])`), and each
`updated` dispatch fully replaces the task object rather than merging. If
`handleDone` fired `onDetachFromRoutine()` and `onRepeatWeekdaysChange(...)`
as two separate calls in the same click, both would be built from the same
pre-edit `current`, and whichever dispatch's reducer application lands last
would silently discard the other's change. This pre-existing risk already
exists for other multi-field edits in this drawer (e.g. changing memo and
time together) and is out of scope to fix generally here — but since
detach+weekdays is directly part of this feature, the design avoids it by
construction (one action, both fields set together).

Note that this protection covers only the detach+weekdays combination.
Detaching together with an edit to any *other* field (memo, time, duration,
priority, background) in the same Done click is still subject to the
general multi-field clobber risk described above — `handleDone` fires each
field's store action separately, all closing over the same pre-edit `task`
snapshot, and whichever dispatch lands last wins. That risk is pre-existing,
not specific to routines, and remains out of scope for this feature; it is
called out here only so this section isn't misread as making detach fully
safe against clobbering.

### Non-goals / accepted quirks

- Not fixing the general multi-field clobber risk elsewhere in
  `handleDone`.
- The `upcomingRepeatDates` "Next: ..." text under the picker is computed
  by the parent from the *anchor's* schedule and passed down as a prop; in
  the brief pre-Done state where the drawer shows the weekday picker but
  detach hasn't committed yet, it may still show the anchor's stale next
  dates. This clears up once Done is clicked and the page recomputes from
  the real (now-detached) task. Not worth suppressing for this transient
  state.
- Detaching a past-dated, still-unfinished occurrence changes its rollover
  eligibility. Routine occurrences are exempt from rollover (`lib/rollover.ts`),
  but once detached, the task becomes a plain task and is no longer exempt,
  so it may get moved into the current week's scope on the next load. This
  is believed to be the correct/intended behavior for a task that's no
  longer part of a routine — it just hadn't previously been written down as
  standalone.

## Testing

- `store.test.tsx`: `detachFromRoutine` clears `repeatSourceId`; with no
  `weekdays` arg leaves `repeatWeekdays` unset; with a `weekdays` arg sets
  it.
- `task-detail-fields.test.tsx`: routine task renders a "Detach" control;
  clicking it calls `onDetachFromRoutine`.
- `task-detail-drawer.test.tsx`: clicking Detach swaps the label for the
  weekday picker immediately; clicking Done after Detach calls
  `onDetachFromRoutine` with no weekdays if none were set, or with the
  chosen weekdays if the user picked some; clicking Cancel/X/Escape after
  Detach calls neither `onDetachFromRoutine` nor `onRepeatWeekdaysChange`.
