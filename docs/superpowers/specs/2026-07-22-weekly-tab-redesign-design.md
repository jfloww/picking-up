# Weekly Tab Redesign

**Date:** 2026-07-22
**Status:** Approved
**Related:** `2026-07-20-weekly-task-rollup-design.md` (the `weeklyRollupTasks` /
week-scope task list this design reuses), `2026-07-20-daily-tab-redesign-design.md`.

## Problem

The Weekly tab (`weekly-view.tsx`) currently renders every week of the
*current month* as a stack of rows: the anchored week is expanded
(`h-28`, 8-column grid of 7 day cells + 1 week-rollup cell), every other
week is collapsed to a thin `h-12` clickable strip. Prev/Next in this view
steps by a whole month (`shiftAnchor`'s `"weekly"` case), and the header
shows the month name, not the week.

This makes every box small — there isn't room to show much per day — and
mixes two jobs (browsing the month's weeks, reading one week's tasks) in
one view. The ask: show exactly one week (Sunday–Saturday) at a time, with
bigger boxes, so each day box and the weekly box actually hold useful
content.

## Goal

Redesign the Weekly tab to show a single week — 7 day boxes plus one big
weekly summary box — with Prev/Next stepping by week instead of month.
Along the way, extend the app's existing drill-down intent to actually
work at both levels: double-clicking a month cell in the Monthly view
jumps to that month's week in the Weekly view, and double-clicking a
day's date in the new Weekly view jumps to that day in the Daily view.

## Layout

```
[‹]   Week of Jul 19 – Jul 25   [›]

┌─────────────────────────────────────────────┐
│  THIS WEEK                                   │
│  12/20 tasks · ▓▓▓▓▓▓░░░░ 60%                │
└─────────────────────────────────────────────┘

┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ Su 19│ Mo 20│ Tu 21│ We 22│ Th 23│ Fr 24│ Sa 25│
│ task │ task │ task │ task │ task │ task │ task │
│ task │ task │      │ task │      │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

- The weekly box is a full-width banner above the 7 day boxes (not beside
  or below them) — approved over a footer-rollup layout, a sidebar layout,
  and an 8-up single-row strip.
- Only one week renders at a time. The current scrollable stack of every
  week in the month is removed — Prev/Next moves the anchor by exactly one
  week (`addDays(anchor, 7 * dir)`), not by month.
- Day boxes are meaningfully bigger than today's `h-28`/`h-12` cells —
  sized to comfortably show several task rows per day, not just peek at
  them. Exact sizing (fixed height vs. flex-fill available space) is left
  to implementation, following the app's existing spacing scale.
- Colors/spacing shown above are wireframe placeholders — the real
  implementation uses the app's existing theme tokens (`bg-card`,
  `bg-muted`, `ring-ring/40`, `text-brand`, `text-subtle`, etc. from
  `globals.css`), not the mockup's ad hoc blue/gray.

## Weekly (hero) box content

Stats only — no task list:

- Count of done vs. total tasks for the week (`12/20`).
- A progress bar reflecting that ratio.
- No per-task list in this box. (A combined week task list already exists
  elsewhere — see "Related" above — and stays there; duplicating it in the
  hero was considered and dropped in favor of keeping the hero glanceable.)

A "streak" indicator appeared in early mockups but there's no existing
streak/consecutive-days concept in the data model — it's cut from this
design. Could be a future addition once there's an actual definition for
it (see Out of scope).

## Day box content

Each of the 7 boxes shows: the date, a done/total count, and that day's
task rows (reusing `ScopeTasks` with `scope: { kind: "day", date }`, as
today). Three visual states layer on top of the normal task row:

| State | Condition | Treatment |
|---|---|---|
| Overdue | Day is in the past and the task is unfinished | Red left border + red-tinted background |
| Pending today | Day is today and the task is unfinished (not yet overdue) | Yellow left border + yellow-tinted background |
| Repeating | Task has `repeatWeekdays` (anchor) or `repeatSourceId` (generated instance) | Small cadence pill at the row's end — e.g. "Daily" (all 7 weekdays), "Weekdays" (Mon–Fri), or the specific days otherwise (e.g. "Mo/We/Fr") |

A task can be both repeating and overdue/pending — the pill and the
border/tint treatment are independent and combine (pill shown regardless
of border color). Normal (non-repeating, on-time or done) tasks are
unstyled, matching today's `TaskItem` appearance. This replaces the
existing `RotateCw`/"Rolled over" icon *only* in the sense that both can
appear on the same row if relevant — rollover (`task.rolledFrom`) and
repeat (`repeatWeekdays`/`repeatSourceId`) are different concepts and both
already exist independently in `task-item.tsx` / `types.ts`.

Future-dated tasks (later in the week, not yet due) get no special
treatment — they render as normal task rows in their day box.

**Interaction with rollover:** `lib/rollover.ts` already converts any
unfinished day-scoped task into a week-scoped task as soon as its date is
in the past (`scope.date < today`), tagging it with `rolledFrom: { kind:
"day", date }` to remember where it came from. Left unhandled, this would
make overdue tasks disappear from their day box entirely (they'd become
invisible, since the hero box carries no task list). So a day box's task
query is not a plain `scope.kind === "day"` match — it also includes
same-week tasks whose `rolledFrom.date` equals that day. This is what
actually makes a task "overdue" from this box's point of view (a rolled
task is by definition from a past, unfinished day); a task still on
`scope.kind === "day"` for a past date without having rolled yet doesn't
arise in practice, since rollover runs on every load and on every
day-change while the app is open.

For a generated repeat instance, the anchor's `repeatWeekdays` isn't
copied onto it (`lib/routines.ts` only sets `repeatSourceId`), so deriving
its pill text requires resolving the anchor task by `repeatSourceId`. Left
to the implementation plan to decide where that lookup happens (e.g. a
selector/helper vs. a store change).

## Navigation & interaction

- **Prev/Next** (existing `ViewSwitcher` buttons, wired through
  `CalendarInner`): for the Weekly view, change `shiftAnchor`'s `"weekly"`
  case from month-stepping to `addDays(anchor, 7 * dir)`. `dateLabelFor`'s
  `"weekly"` case changes from `monthLabel(monthKeyOf(anchor))` to a new
  week-range label (e.g. "Jul 19 – Jul 25"), built from `weekDates
  (weekStartOf(anchor))` — needs a new helper in `lib/dates.ts` alongside
  the existing `monthLabel`/`dayLabel`.
- **Click a task row** → opens `TaskDetailPanel` for that task. `TaskItem`
  already supports this via its optional `onSelect` prop (falls back to
  inline expand when omitted) — `ScopeTasks` needs a new optional
  `onSelectTask` passed through to `TaskItem`, and `WeeklyView` needs
  selected-task state plus a `TaskDetailPanel` render, following the same
  pattern `DailyView` already uses for its timeline.
- **Double-click a day's date/header** → navigates to the Daily tab
  anchored on that date. This interaction doesn't exist anywhere in the
  codebase today (grepped for `onDoubleClick`/`dblclick` — no matches), so
  it's new: `CalendarViewProps` (shared by all four views) needs a new
  callback (e.g. `onDrillDown: (dateKey: string) => void`) that changes
  *both* `view` and `anchor` together, plumbed from `CalendarInner`. The
  Weekly view wires this to each day box's date.

  **Correction from the original brainstorm:** the "Monthly" tab
  (`monthly-view.tsx` → `YearGrid`) does not show individual days — it
  shows a grid of the year's 12 *months*, with the focused month expanded
  and a side panel of that month's month-scoped tasks (`YearlyView` reuses
  the same `YearGrid` for a 12-month overview with no focus interaction).
  There is no per-date cell to double-click in Monthly. So the
  month→week drill-down instead applies to `YearGrid`'s month cells: when
  `onFocusMonth` is set (i.e. only in `MonthlyView`, not `YearlyView`),
  double-clicking a month cell jumps to `weekly` view anchored at
  `` `${month}-01` `` (the same date `onFocusMonth` already uses for its
  single-click focus). Single-click keeps today's exact behavior
  (`onFocusMonth` — focus that month within the Monthly tab); double-click
  is additive, drilling a level down instead.

## Out of scope (this iteration)

- Streak / consecutive-completion tracking in the hero box — no such
  concept exists in the data model yet.
- Any change to the Daily tab's own layout, or to how Monthly/Yearly
  render their month cells — this touches Monthly only for the
  double-click drill-down wiring described above, nothing else about how
  it renders.
- Wiring the same double-click drill-down into `YearlyView` (Yearly's
  month cells have no click interaction at all today — adding one, even
  just to jump to Monthly, is a separate follow-up).
- Changing what counts toward the weekly done/total stat (reuses whatever
  `weeklyRollupTasks` already considers "this week's tasks" — see the
  2026-07-20 weekly-rollup spec).
- Redesigning `TaskDetailPanel` itself — Weekly reuses it exactly as
  `DailyView` does today.
- Swipe gestures or a date-picker alternative to Prev/Next — arrows only,
  per approved direction.
