# Task Time Editor: Start/End Instead of Start/Duration

**Date:** 2026-08-06
**Status:** Approved

## Problem

`TaskTimeEditor` currently pairs a Start time picker with a numeric
"Duration (minutes)" field plus a preset datalist (15m/30m/.../2h). Users
think in terms of when a task starts and ends, not how many minutes it
lasts — entering an End time directly is more natural.

## Goal

Replace the Duration-minutes input with an End time picker, in both of
`TaskTimeEditor`'s variants (`default` and `drawer`), with no changes to
the underlying data model or to any of this component's callers.

## Scope decisions (brainstormed and approved)

- **Both variants** (compact/timeline editor and the drawer) switch
  together — no inconsistency between where a task's time is edited.
- **Presets dropped entirely.** No "+15m/+30m" quick-fill replacement —
  just two plain `type="time"` inputs.
- **No prop changes.** `TaskTimeEditor` still receives/emits exactly
  `time`/`onTimeChange`/`durationMinutes`/`onDurationChange` — Start and
  `durationMinutes` remain the real stored fields (`Task.time`,
  `Task.durationMinutes` in `types.ts`); "End" is purely a derived,
  in-component presentation of `time + durationMinutes`, computed with
  the existing `addMinutesToTime`/`timeToMinutes` helpers
  (`lib/times.ts`) — no new store action, no new `Task` field, and no
  caller of `TaskTimeEditor` (`task-detail-fields.tsx`) needs to change.
- **Invalid End (at or before Start) is silently rejected, not
  error-shown.** Since End's displayed value is derived (not locally
  buffered state), a rejected edit simply doesn't call `onDurationChange`
  — the field reverts to showing the last valid End on the next render.
  No new error-message UI vocabulary introduced.
- **Editing Start preserves End's absolute clock time**, not the
  duration — recomputes `durationMinutes` so End stays put. If the new
  Start would land at or after the existing End, the duration is cleared
  (End becomes unset) rather than either blocking the Start edit or
  producing a negative/zero duration. Start must always be freely
  re-timeable; only the derived End/duration silently drops if it can no
  longer make sense.

## Interaction design

Computed once per render inside `TaskTimeEditor`:
```
const endTime = time && durationMinutes ? addMinutesToTime(time, durationMinutes) : "";
```

**End input `onChange`:**
```
function handleEndChange(newEnd: string) {
  if (!newEnd || !time) return;
  const duration = timeToMinutes(newEnd) - timeToMinutes(time);
  if (duration <= 0) return; // reject; input reverts via the derived value above
  onDurationChange(duration);
}
```

**Start input `onChange`:**
```
function handleStartChange(newTime: string | undefined) {
  onTimeChange(newTime);
  if (newTime && durationMinutes !== undefined && time) {
    const oldEnd = addMinutesToTime(time, durationMinutes);
    const newDuration = timeToMinutes(oldEnd) - timeToMinutes(newTime);
    onDurationChange(newDuration > 0 ? newDuration : undefined);
  }
}
```

A `min={time}` attribute on the End `<input type="time">` is added as a
native-browser defense-in-depth hint alongside the JS-level check (some
browsers grey out times before `min` in their picker UI), not a
replacement for it.

## Non-goals

- No new store action, no new `Task` field.
- No quick-fill preset replacement for the dropped duration presets.
- No inline validation error messages.
- No change to how duration is *displayed* elsewhere (e.g.
  `formatTaskTimeRange` in `task-item.tsx`, which already renders a
  Start–End range from `time`/`durationMinutes` and needs no changes).
