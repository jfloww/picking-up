# Task Calendar Design — Multi-Scale To-Do Views

**Date:** 2026-07-16
**Status:** Approved

## Concept

A to-do list app where every view shows the *parent* time container with the
current unit in focus — "zoomed-out context, focused present." Four scales:
Daily, Weekly, Monthly, Yearly. Default is **Weekly**.

The nesting is: Daily ⊂ Weekly ⊂ Monthly ⊂ Yearly. Each view renders its
container grid, emphasizes the current unit, and fades the rest.

## Navigation & UX

- Lives at `/app` (replaces the placeholder page).
- Segmented control at top: **Daily | Weekly | Monthly | Yearly**, default Weekly.
- **‹ ›** arrows move the anchor date by one unit of the current view's
  container (Weekly view pages by month, Monthly/Yearly by year, Daily by week).
- **Today** button returns focus to the current date.
- Clicking a faded unit refocuses on it (view/edit past and future periods).
  Changing scale happens only via the segmented control — no zoom-on-click.
- Visual style follows the existing Tesla-minimal design system and reuses
  `frontend/src/components/ui/` primitives; light/dark theme aware.

## The Four Views

### Weekly (default)
The anchor month's calendar grid: Su–Sa columns plus a **Weekly** column on the
right. The focused week's row is expanded — full opacity, taller, tasks with
checkboxes, quick-add input per day cell. Other weeks are faded: tasks visible
but dimmed, row clickable to refocus. The focused week's Weekly cell shows:
period-level tasks, rolled-over unfinished tasks (marked as rolled), and week
notes.

### Daily
A single week strip (Su–Sa + Weekly cell). Today is expanded/focused; other
days faded but visible and clickable.

### Monthly
The year grid (12 months + a **Monthly** cell). Current month focused, showing
its month-level tasks; other months faded.

### Yearly
The same year grid with **no fading** (top of the hierarchy), plus a **Yearly**
cell for year-level goals/notes.

## Task Model

```ts
Task {
  id: string
  title: string
  memo?: string          // shown when opening the task
  done: boolean
  scope:
    | { kind: "day",   date: "2026-07-16" }
    | { kind: "week",  weekStart: "2026-07-12" }   // Weekly cell (weeks start Sunday)
    | { kind: "month", month: "2026-07" }          // Monthly cell
    | { kind: "year",  year: "2026" }              // Yearly cell
  rolledFrom?: Scope     // set when auto-rolled; renders a "rolled over" mark
  createdAt: string
  completedAt?: string
}
```

Minimal task anatomy for this version: title + done checkbox + optional memo.
No priority, tags, due times, or recurrence yet.

## Rollover Rules

Applied automatically as a pure function over the task list whenever the app
loads or the date changes (lazy migration — no background jobs):

1. A **day task** left unchecked after its day passes moves to that week's
   **Weekly cell**, marked as rolled (`rolledFrom` set to its original scope).
2. A **week task** (including previously rolled ones) left unchecked after the
   week ends moves to the **next week's Weekly cell** — it keeps following the
   user forward until done or deleted.
3. An unfinished **month task** rolls into the **next month's** Monthly cell.
   **Year tasks** stay put.

Rollover never touches completed tasks. The function is deterministic:
given the same task list and "today," it always produces the same result.

## Storage & Architecture

**Frontend-first:** tasks persist in `localStorage` behind a repository
interface (`list / create / update / delete`), so a Django-API-backed
implementation can be swapped in later without touching the UI. State
management is plain React context + reducer — no new state library.

New code lives in `frontend/src/features/tasks/`:

```
features/tasks/
  types.ts               // Task, Scope
  lib/dates.ts           // week ranges, month-grid math (weeks start Sunday)
  lib/rollover.ts        // pure rollover function
  data/repository.ts     // TaskRepository interface + localStorage impl
  store.tsx              // context + reducer provider
  components/
    view-switcher.tsx    // segmented control + arrows + Today
    period-cell.tsx      // shared cell with focused/faded states
    task-item.tsx        // checkbox + title, opens memo
    task-list.tsx
    quick-add.tsx
    views/
      daily-view.tsx
      weekly-view.tsx
      monthly-view.tsx
      yearly-view.tsx
```

`app/app/page.tsx` renders the calendar inside the existing authenticated
layout.

## Error Handling

- Corrupt or missing localStorage data falls back to an empty task list
  without crashing (schema-validated on read).
- All date math goes through `lib/dates.ts` so edge cases (month boundaries,
  year boundaries, weeks spanning two months) are handled in one tested place.

## Testing

- **Vitest** (added minimally) for the pure logic: `lib/dates.ts` grid math and
  `lib/rollover.ts` (day→week, week→next-week, month→next-month, boundary
  cases, completed tasks untouched).
- Component smoke tests for the four views (render with sample data, focused
  vs. faded states present).

## Out of Scope (this iteration)

- Django backend / server persistence (repository interface prepares for it)
- Yearly zoom-out beyond one year
- Task priority, tags, times, recurrence
- Drag-and-drop between cells
- Mobile app
