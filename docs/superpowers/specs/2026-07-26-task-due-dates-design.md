# Task Due Dates

**Date:** 2026-07-26
**Status:** Approved

## Problem

A task's only date concept today is `scope` (`frontend/src/features/tasks/types.ts:1-5`) — which day/week/month/year bucket it's filed under and shown on. There is no way to say "this is due Friday" for a task that isn't scheduled to be *worked on* Friday — e.g. a task sitting in this week's bucket with a hard deadline later in the week. Scope and deadline are being conflated.

## Goal

Let any non-routine task carry an optional due date, independent of its `scope`, and surface it as a small badge on the task row wherever that task renders (day, week, month, year views).

## Behavior

- A task gets an optional `dueDate` (`"YYYY-MM-DD"`), settable/clearable from the task detail view (drawer and inline expanded row), next to Priority/Background/Repeat.
- The badge label is relative: `"Due Today"` if due date is today, `"Due Fri"` (weekday) if 1–7 days out, otherwise a short date (`"Due Aug 14"`). Past-due dates also fall back to the short-date form (a bare weekday name for a date already gone is ambiguous — "was that last Friday?").
- No urgency gradient. The badge is flat/neutral (same `bg-muted` pill style as the existing Priority/Background/repeat-count badges) except for one on/off signal: it turns destructive-red once the due date has passed **and the task isn't done**. Marking the task done clears the red immediately, even if the due date is still in the past.
- Routine tasks (an anchor with `repeatWeekdays` set, or an instance with `repeatSourceId` set) don't get a due-date editor — a single fixed date doesn't fit a task that recurs. If a task already has `dueDate` set and is then turned into a routine via the repeat picker, `dueDate` is cleared at that moment (see "Store action" below) so a stale badge can't linger on a task whose editor has disappeared.
- Shown on `TaskItem`'s `"default"` and `"large"` sizes. Not shown on `"timeline"` size — that layout is already stripped to checkbox + title + time with no room for more badges.

## Design

### Data model (`types.ts`)

Add one optional field to `Task`:

```ts
dueDate?: string; // "YYYY-MM-DD"; independent of scope; unset for routines
```

No change to `Scope`, no migration — existing persisted tasks (`repository.ts`, localStorage key `picking-up.tasks.v1`) simply lack the field, which is valid since it's optional.

### Date/label helpers (`lib/dates.ts`)

Two new functions, alongside the existing `shortDateLabel`/`todayKey`/`parse` helpers:

```ts
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parse(toKey).getTime() - parse(fromKey).getTime()) / 86_400_000);
}

export function isOverdue(dueDate: string, today: string): boolean {
  return dueDate < today;
}

export function dueDateLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return "Due Today";
  if (diff > 0 && diff <= 7) {
    const weekday = parse(dueDate).toLocaleDateString("en-US", { weekday: "short" });
    return `Due ${weekday}`;
  }
  const d = parse(dueDate);
  return `Due ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
}
```

`dueDate` keys are zero-padded `YYYY-MM-DD`, so `isOverdue`'s string comparison is safe (matches how the codebase already compares date keys elsewhere, e.g. rollover logic).

### Store action (`store.tsx`)

New action, following the existing per-field pattern (`setPriority` at `store.tsx:204-210`):

```ts
setDueDate(id, dueDate) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current) return;
  const task: Task = { ...current, dueDate };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
```

Add `setDueDate: (id: string, dueDate: string | undefined) => void;` to `TasksContextValue`.

`setRepeatWeekdays` (`store.tsx:178-185`) gains one line to close the stale-badge loophole described above:

```ts
setRepeatWeekdays(id, weekdays) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current) return;
  const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
  const task: Task = {
    ...current,
    repeatWeekdays: normalized,
    dueDate: normalized ? undefined : current.dueDate,
  };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
```

### New component: `TaskDueDateEditor` (`components/task-due-date-editor.tsx`)

Mirrors `TaskTimeEditor`'s structure and styling (`task-time-editor.tsx:16-93`) but simpler — one native `<input type="date">` plus a conditional Clear button:

```tsx
export function TaskDueDateEditor({
  dueDate,
  onDueDateChange,
  variant = "default",
}: {
  dueDate?: string;
  onDueDateChange: (dueDate?: string) => void;
  variant?: "default" | "drawer";
}) {
  const drawer = variant === "drawer";
  return (
    <label className={cn("flex flex-col gap-1", drawer && "gap-1.5")}>
      {drawer && <span className="text-[11px] font-medium text-subtle">Due date</span>}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dueDate ?? ""}
          onChange={(e) => onDueDateChange(e.target.value || undefined)}
          aria-label="Due date"
          className={cn(
            "rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "px-2.5 py-1.5 text-sm",
          )}
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => onDueDateChange(undefined)}
            className={cn("text-xs text-subtle hover:text-foreground", drawer && "text-sm hover:underline")}
          >
            Clear
          </button>
        )}
      </div>
    </label>
  );
}
```

### `TaskDetailFields` (`task-detail-fields.tsx`)

New props: `dueDate: task.dueDate` is read directly off `task` (same convention as `task.priority`/`task.background`), plus `onDueDateChange: (dueDate?: string) => void`.

New section, placed after the Repeat section (`task-detail-fields.tsx:72-104`) and before the Priority/Background row:

```tsx
const isRoutine = task.repeatWeekdays !== undefined || task.repeatSourceId !== undefined;
```

```tsx
{!isRoutine && (
  <section className={cn(drawer && "space-y-3")}>
    <TaskDueDateEditor
      dueDate={task.dueDate}
      onDueDateChange={onDueDateChange}
      variant={variant}
    />
  </section>
)}
```

### Inline row (`task-item.tsx`) — immediate commit

Same wiring shape as every other field here:

- `TaskItemActions` gains `setDueDate: (id: string, dueDate: string | undefined) => void;`.
- `taskItemHandlers()` gains `onDueDateChange: (dueDate?: string) => actions.setDueDate(id, dueDate)`.
- `TaskItem` accepts and passes through `onDueDateChange` to `TaskDetailFields`.

### Drawer (`task-detail-drawer.tsx`) — buffered until Done

Per the existing buffered-edit pattern:

- `Draft` gains `dueDate?: string`; `draftFromTask` sets it from `task.dueDate`.
- `TaskDetailFields` receives `onDueDateChange={(dueDate) => setDraft((d) => ({ ...d, dueDate }))}` — no special handling needed since (unlike `detached`) `dueDate` is a plain passthrough field, already covered by the existing `draftTask = { ...task, ...draftFields }` spread (`task-detail-drawer.tsx:112-117`).
- `handleDone` (`task-detail-drawer.tsx:93-110`) gains one line: `if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);`.
- The drawer's own props gain `onDueDateChange: (dueDate?: string) => void`, satisfied by the same `taskItemHandlers()` spread used for every other field — no changes needed in `daily-view.tsx`/`weekly-view.tsx`.

### Badge display (`task-item.tsx`)

Computed once near the top of `TaskItem`'s render body, alongside the existing `timeBadge`:

```tsx
const today = todayKey();
const dueBadge = task.dueDate && (
  <span
    className={cn(
      "shrink-0 rounded bg-muted font-medium text-muted-foreground",
      large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
      isOverdue(task.dueDate, today) && !task.done && "bg-destructive/10 text-destructive",
    )}
  >
    {dueDateLabel(task.dueDate, today)}
  </span>
);
```

Rendered in the same badge row as `repeatLabel`/`task.priority`/`task.background` (`task-item.tsx:251-280`), after the subtask count badge.

### Non-goals / accepted quirks

- No urgency gradient (explicitly out of scope per this feature's requirements) — only the binary overdue/not-overdue signal.
- `TaskDueDateEditor` is not shown in the quick-add flow; due dates are set from the task detail view only.
- The badge doesn't render on `"timeline"` size.

## Testing

- `lib/dates.test.ts`: `dueDateLabel` boundary cases (today, 1 day out, exactly 7 days out, 8 days out, a past date); `isOverdue` true/false at the boundary (`dueDate === today` is not overdue).
- `store.test.tsx`: `setDueDate` sets/clears the field; `setRepeatWeekdays` clears `dueDate` when given a non-empty weekdays array, and leaves it untouched when clearing weekdays (empty/undefined).
- `task-detail-fields.test.tsx`: due-date editor renders for a non-routine task and is absent for a routine task (`repeatWeekdays` set, and separately `repeatSourceId` set); changing the date and clicking Clear both call `onDueDateChange` with the expected value.
- `task-item.test.tsx` (or wherever `TaskItem` badges are currently tested): badge renders with the expected label; turns destructive-red when overdue and not done; stays neutral when overdue but done; absent on `"timeline"` size.
- `task-detail-drawer.test.tsx`: editing due date and clicking Done calls `onDueDateChange`; clicking Cancel/X/Escape does not.
