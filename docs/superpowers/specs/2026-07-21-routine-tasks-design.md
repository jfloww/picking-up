# Routine (Recurring) Tasks Design

**Date:** 2026-07-21
**Status:** Approved

## Problem

Tasks are one-offs today — there's no way to say "this happens every Monday/Wednesday/Friday" or "every day." You have to re-add the same task by hand on every matching day.

## Goal

Any day-scoped task can be turned into a routine by picking which weekdays it repeats on. From then on, a fresh independent task for that title auto-appears on each matching day, without cluttering the Weekly list with missed days or requiring a separate "routine" concept to manage.

## Non-goals (this iteration)

- No monthly/yearly recurrence, no "every N days" — weekday-of-week only.
- No backfill for days the app wasn't opened on (see Materialization below).
- No editing a routine's pattern from a generated occurrence — only from the task that started it (the anchor). See UI section.
- No standalone "manage my routines" list view.

## Design decisions

- **Recurrence shape:** a single weekday multi-select (Su/Mo/Tu/We/Th/Fr/Sa). "Every day" is just all seven checked — no separate mode.
- **Creation flow:** no separate "add routine" entry point. Any existing or newly-added day-scoped task can be turned into a routine from its own detail view by picking weekdays.
- **Materialization timing:** an occurrence for a given weekday is created only once that day actually arrives (becomes `todayKey()`), reusing the app's existing rollover-check timing (mount + `focus`/`visibilitychange`). No pre-generation of future days. Consequence: browsing forward to a future matching day in the Daily tab will not show that day's occurrence until the day is actually reached.
- **Edit/stop semantics:** once a day's occurrence is generated, it is a fully independent task — editing or stopping the routine afterward never rewrites or deletes already-generated occurrences. This falls out naturally from the data model below (occurrences copy the anchor's fields at generation time and never reference the anchor again).

## Data model

Two new optional fields on `Task` (`frontend/src/features/tasks/types.ts`):

```ts
export interface Task {
  // ...existing fields...
  repeatWeekdays?: number[]; // 0=Sun..6=Sat; set only on the anchor task
  repeatSourceId?: string;   // set only on a generated occurrence; points to the anchor's id
}
```

A task is never both. `repeatWeekdays` present marks a task as an **anchor** — the specific day-scoped task where repeat was first turned on. It renders and behaves as a completely normal task on its own day; it isn't hidden or templated away, it just additionally carries the rule for spawning future days. `repeatSourceId` present marks a task as a **generated occurrence** of that anchor.

Unchecking every weekday on an anchor clears `repeatWeekdays` to `undefined` (same pattern as the existing time field's "Clear" button) — the task stops being an anchor entirely; already-generated occurrences are unaffected.

## Generation logic

`lib/dates.ts` gains one small exported helper alongside its existing private `parse()`/`toKey()` (used internally by `weekStartOf` for the identical `.getDay()` computation, so this reuses rather than duplicates that parsing):

```ts
export function weekdayOf(dateKey: string): number {
  return parse(dateKey).getDay();
}
```

New pure function `materializeRoutines(tasks, today)` in a new `frontend/src/features/tasks/lib/routines.ts`, structurally parallel to the existing `rolloverTasks` (`lib/rollover.ts`):

```ts
import { weekdayOf } from "./dates";

export function materializeRoutines(tasks: Task[], today: string): Task[] {
  const todayWeekday = weekdayOf(today);
  const anchors = tasks.filter(
    (t): t is Task & { repeatWeekdays: number[] } =>
      t.repeatWeekdays !== undefined && t.repeatWeekdays.includes(todayWeekday),
  );
  return anchors
    .filter((anchor) => {
      // The anchor's own day already covers `today` if that's where it lives —
      // without this check, the very day repeat is turned on would spawn a
      // second, duplicate occurrence alongside the anchor itself.
      if (anchor.scope.kind === "day" && anchor.scope.date === today) return false;
      return !tasks.some(
        (t) =>
          t.repeatSourceId === anchor.id &&
          t.scope.kind === "day" &&
          t.scope.date === today,
      );
    })
    .map((anchor) => ({
      id: crypto.randomUUID(),
      title: anchor.title,
      memo: anchor.memo,
      time: anchor.time,
      done: false,
      scope: { kind: "day", date: today },
      repeatSourceId: anchor.id,
      createdAt: new Date().toISOString(),
    }));
}
```

Unlike `rolloverTasks` (which only *transforms* existing tasks in place), this function *adds* tasks — it returns just the new occurrences to create, not the whole array. Copying the anchor's title/time/memo **as they are at generation time** is what makes "future occurrences reflect edits, past occurrences stay locked in" fall out for free — no extra propagation logic needed.

### Store wiring

`frontend/src/features/tasks/store.tsx` already runs `rolloverTasks` in two places: the initial `repo.list().then(...)` in the mount effect, and the `focus`/`visibilitychange` day-change check. Both get one addition immediately after the existing `rolloverTasks` call:

```ts
const rolled = rolloverTasks(tasks, today);
const spawned = materializeRoutines(rolled, today);
const finalTasks = [...rolled, ...spawned];
dispatch({ type: "loaded", tasks: finalTasks });
// existing diff-and-persist loop over `rolled` still calls repo.update(task)
// for changed tasks; `spawned` tasks are new, so each gets repo.create(task)
```

No new effect, no new timer — this rides the exact mechanism that already re-checks the day on every app open/focus.

## UI

A new **"Repeat on" row** in `TaskDetailFields` (`frontend/src/features/tasks/components/task-detail-fields.tsx`): seven toggle buttons using the existing `DAY_LABELS` array (`views/weekly-view.tsx`), shown only when `task.scope.kind === "day"`.

- **Anchor task (or a plain task with no routine yet):** the row is fully editable. Toggling a day writes to that task's `repeatWeekdays` via a new store action `setRepeatWeekdays(id, weekdays: number[] | undefined)`, following the exact shape of the existing `setTime`/`setMemo` actions in `store.tsx`.
- **Generated occurrence (`repeatSourceId` set):** the row is replaced by a small read-only indicator — the same treatment `TaskItem` already gives `rolledFrom` (a small icon with `aria-label="Part of a routine"`). To change the pattern, the user goes back to the anchor's day and edits the picker there.

## Interactions with existing features

- **Rollover exemption:** `rolloverTasks` (`lib/rollover.ts`) gets one added guard — skip any task with `repeatSourceId` set, so a missed occurrence stays exactly where it is (day-scoped, in the past, undone) instead of rolling into the current week's Weekly cell. The anchor task itself is not exempt; only tasks generated *from* one are.
- **Weekly rollup / Daily-tab exclusion:** no special-casing needed. Generated occurrences are ordinary day-scoped tasks, so they already interact correctly with `weeklyRollupTasks` and the `excludeDate` filter (from the prior daily/weekly-panel-fixes work) — an occurrence on the Daily tab's anchor day is excluded from the Weekly list automatically, exactly like any other day task.
- **Deletion:** deleting the anchor removes `repeatWeekdays` along with it, so `materializeRoutines` simply stops finding it — no future occurrences, but every occurrence already generated remains untouched (each is a fully independent task). Deleting a generated occurrence just deletes that one day's task normally, with no effect on the anchor or future generation.

## Testing

- `lib/routines.test.ts` (new): `materializeRoutines` creates today's occurrence when the weekday matches and none exists yet; doesn't duplicate if one already exists for today; doesn't spawn a duplicate when the anchor itself is already scoped to today; ignores anchors whose weekday doesn't match today; copies the anchor's *current* title/time/memo at generation time (not stale values from when the anchor was first created).
- `lib/rollover.test.ts`: add a case confirming a `repeatSourceId`-tagged task is left in place (not rolled into the current week) even when its day has passed.
- `store.test.tsx` (or wherever the mount/day-change effects are covered): confirm a spawned occurrence is persisted via `repo.create`, not `repo.update`.
- `task-detail-fields.test.tsx`: the "Repeat on" row renders only for day-scoped tasks; toggling a day updates `repeatWeekdays`; unchecking every day clears it to `undefined`.
- `task-item.test.tsx` / `primitives.test.tsx`: a task with `repeatSourceId` shows the read-only "Part of a routine" indicator instead of an editable picker.
