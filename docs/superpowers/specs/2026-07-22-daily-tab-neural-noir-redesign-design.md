# Daily Tab Neural Noir Redesign

**Date:** 2026-07-22
**Status:** Approved
**Related:** `2026-07-22-daily-tab-agenda-redesign-design.md` (the current two-column
layout — hour-rail + `DayAgenda` — this builds on and partially replaces).
**Source:** A Superdesign mockup ("Focus Planner - Fixed Layout & Sidebar CTA",
Superdesign project `878185a1-e629-4147-be3e-964cb6849920`, draft
`328ffbe2-d400-46de-b36e-6c6c716ad591`) provided as a single self-contained HTML
file. This spec adapts that mockup's layout, information architecture, and
visual language to this codebase's data model and design-token conventions —
it is not a literal port.

## Problem

The Daily tab just shipped its current shape (hour-rail left, single
chronological "All day" agenda right, in-place detail panel via `ShrinkStack`).
The mockup proposes a different visual language ("Neural Noir": near-black
surfaces, gold accent) and information architecture (agenda split by
status/type, a slide-in detail drawer, a lightweight priority flag) that reads
as more scannable for a focus-oriented daily view. This spec defines how much
of that to adopt, and how to fit it into the app's existing token-based theme
system rather than the mockup's hardcoded hex values.

## Explicitly out of scope

- The Weekly, Monthly, and Yearly tabs — untouched, not redesigned, not
  reviewed against the mockup's own (unused) weekly section.
- The shared header/chrome (`task-calendar.tsx`'s date label, `ViewSwitcher`
  tabs, Today/prev/next controls) — stays exactly as it is today. This spec
  only touches the Daily tab's two-column content area below that header.
- The mockup's fixed 8am–8pm static timeline layout — the current 24h
  scrollable rail with now-line and auto-scroll-to-now is real functionality
  and is kept, restyled only.
- Task duration/end-time and a category tag (e.g. "Personal") — no data model
  support exists or is being added for these; the mockup's "Planned: 3h 15m"
  header stat and category tags are omitted entirely.
- The mockup's click-to-reveal "+ New task" button — `QuickAdd`'s existing
  always-open input is kept, restyled only.

## Data model: a lightweight priority flag

`frontend/src/features/tasks/types.ts`'s `Task` gains one new optional field:

```ts
priority?: boolean;
```

A task either is or isn't flagged priority — no levels. This is a plain,
optional, boolean field following the exact pattern `rolledFrom`/`memo`
already use: absent means `false`/unset, no migration needed for existing
stored tasks.

- `data/repository.ts`'s `normalizeTask` gains the same coercion pattern
  already used for `repeatSourceId` (`typeof task.priority === "boolean" ?
  task.priority : undefined`). `isTask` needs no change — it only validates
  required fields, and `priority` is optional.
- `store.tsx` gains `setPriority(id: string, priority: boolean): void` on
  `TasksContextValue`, implemented identically to `setMemo`/`setTime`: find
  the task, spread with the new value, dispatch `updated`, `repo.update`.
- The field is global (available to every view), but this iteration only
  reads or renders it from the Daily tab's components below. Other views
  (Weekly day boxes, Monthly/Yearly previews) simply don't display it yet —
  harmless, since it's optional and additive.

## Same-day, time-of-day overdue

Today, "overdue" only exists as a whole-day comparison (Weekly's
`highlightOverdue`, comparing calendar dates). The mockup's "Next Up" section
introduces a same-day concept: a timed, undone task whose time has already
passed *today* reads as overdue, distinct from one still upcoming ("pending").

`lib/times.ts` gains:

```ts
function isPastToday(time: string, date: string, today: string, nowTime: string): boolean
```

True when `date === today && time < nowTime` (string comparison on `"HH:MM"`,
matching the file's existing `timeToMinutes`/time-string conventions). This is
a pure function taking "now" as an argument (not reading the clock itself),
matching the codebase's no-wall-clock-dependence testing convention.

Visually this reuses `TaskItem`'s existing `highlight?: "overdue" | "pending"`
prop (added in the Weekly redesign) — no new visual language. The same
computed highlight is applied to both the rail chip (`DayTimeline`) and the
agenda card (new `DayAgenda`) for the same task, so a task doesn't look
overdue in one place and merely pending in the other.

## Theme tokens: nudging dark mode toward Neural Noir

No new tokens, no hardcoded hex in any component. `globals.css`'s `.dark`
block gets its *values* adjusted toward the mockup's palette, while keeping
every existing token name and the light theme untouched:

- `--brand` / `--ring` (currently `#6f9cc4`, steel-blue) shift toward a warm
  gold in dark mode only, echoing the mockup's `--accent: #D4A85F`.
- `--background`, `--card`, `--secondary`/`--muted`, `--border` shift toward
  the mockup's near-black surface scale (`#0A0B0C` canvas → `#121518`
  surface → `#181C20` raised → hairline borders at low-opacity white),
  replacing the current `#0f1214`/`#171b1e`/`#22272b` dark values.
- `--warning` and `--destructive` are unchanged — they already carry the
  overdue/pending semantics this redesign reuses.
- **This changes dark mode app-wide**, not just the Daily tab — Weekly,
  Monthly, and Yearly inherit the new dark palette automatically, since they
  already consume the same tokens. That's expected and desired: one dark
  theme, not a per-tab theme. Light mode is untouched.

## Component changes

### `TaskItem`

Reads `task.priority` directly (same pattern as `task.rolledFrom`) and, when
true, renders a small "Priority" badge — same treatment level as the existing
repeat-cadence pill (`text-[10px]`/`text-xs` depending on `size`), placed
alongside it after the time. No new props needed; this is intrinsic task
data, not a per-view-computed value like `highlight`/`repeatLabel`.

### `TaskDetailFields`

Gains a priority toggle (checkbox, matching the existing field list's visual
weight — same row style as the repeat picker) wired to a new `onPriorityChange:
(priority: boolean) => void` prop, threaded through by both `TaskDetailPanel`
and the new `TaskDetailDrawer` below via `taskItemHandlers` (which gains
`onPriorityChange: () => actions.setPriority(id, ...)` alongside its existing
callbacks). The mockup shows two different priority badge treatments (a
neutral tag in lists, a bold red "High Priority" badge in the drawer) — this
spec uses **one** consistent, neutral treatment everywhere (matching the
repeat-cadence pill), in both `TaskItem`'s badge and the drawer's toggle. No
separate "urgent" color language for priority — that would collide visually
with the overdue/pending highlight, which already owns red/amber in this UI.

### `DayAgenda` — three sections

Restructured from one flat, sorted list into three labeled sections, in this
order:

1. **All Day To-Do** — untimed, undone tasks (`scope.kind === "day" &&
   !task.time && !task.done`).
2. **Next Up** — timed, undone tasks (`!!task.time && !task.done`), sorted
   ascending by time. Each gets `highlight="overdue"` or `"pending"` via the
   same-day time comparison above.
3. **Done Today** — every done task for the day, regardless of timed/untimed,
   dimmed (existing `opacity-*` treatment, matching how completed items
   already render elsewhere).

One `QuickAdd`, pinned at the bottom, spans all three sections (adds a plain
day-scoped task with no time/priority — those are set afterward via the
detail drawer, same as today). The `agendaZoneRef` drop-zone (drag-to-clear-
time target) wraps the whole sectioned container, not per-section — dragging
a rail chip anywhere onto the agenda still clears its time, regardless of
which section it lands in or ends up in afterward.

Empty sections render nothing (no section header for a section with zero
tasks) rather than an empty-state message — keeps the agenda compact on light
days.

### New `TaskDetailDrawer`

A fixed-position slide-in overlay, replacing `TaskDetailPanel`'s in-place
`ShrinkStack` swap for the Daily tab specifically (`TaskDetailPanel` itself is
untouched and keeps its current callers elsewhere, e.g. any future reuse).
`TaskDetailDrawer` wraps the existing `TaskDetailFields` plus a header (title,
checkbox, close button) — same responsibilities as today's `TaskDetailPanel`,
different chrome:

- `fixed inset-y-0 right-0`, translate-x transition to slide in/out (matching
  the mockup's `translate-x-full` → `translate-x-0` pattern), width via an
  existing spacing-scale value (not a new hardcoded pixel token).
- Closes the same way `TaskDetailPanel` does today (re-clicking the selected
  task's title), plus its own explicit close button, plus `Escape`-to-close
  (new — appropriate for an overlay pattern, wasn't needed for the in-place
  panel).
- Uses the app's token-based surface/border/shadow classes (`bg-card`,
  `border-border`, existing shadow utilities) — no hardcoded hex, matching
  every other component in this codebase.

### `DailyView`

- Drops the `ShrinkStack` swap entirely — both columns render at full size
  all the time now, since the drawer overlays instead of swapping into the
  right column. `DayAgenda` no longer needs a `primaryMinHeight` concern.
- Grid ratio changes from equal columns (`grid-cols-2`) to 60/40
  (`grid-cols-[3fr_2fr]` or equivalent), matching the mockup's timeline/
  sidebar proportion.
- Renders `TaskDetailDrawer` as a sibling overlay (alongside the existing
  drag-ghost overlay) when a task is selected, instead of conditionally
  swapping it into the right column.
- `railRef`/`agendaZoneRef`/`useDragToSchedule` ownership is unchanged from
  today — this spec doesn't touch drag-to-schedule's mechanics, only where
  the detail view renders.

### `DayTimeline`

No behavioral change. Visual restyling only, inherited automatically from the
adjusted dark-mode token values above (chip background, hour-marker color,
now-line color) — no changes to the component's logic, props, or the 24h
scroll/now-line/auto-center behavior.

## Testing considerations

- `day-agenda.test.tsx` needs the heaviest rework: today's single sorted-list
  assertions become three section-scoped assertions (each section's
  membership rule, empty-section suppression, and the same-day overdue/
  pending highlight on "Next Up" items).
- New tests needed for `isPastToday` in `times.test.ts` (pinned-clock,
  following the file's existing convention), the new `setPriority` store
  action, and `TaskDetailDrawer`'s open/close/Escape behavior.
- `daily-view.test.tsx`'s `ShrinkStack`-position assertions
  (`shrink-stack-primary`/`shrink-stack-secondary` testids) are removed since
  `ShrinkStack` is no longer used here; replaced with drawer-open/closed
  assertions against the new fixed-overlay markup.
- The exact test-by-test migration is left to the implementation plan.

## Out of scope (this iteration)

- Priority levels beyond a single boolean (no "medium priority", no sort-by-
  priority).
- Surfacing `priority` in Weekly/Monthly/Yearly views.
- Any change to `use-drag-to-schedule.ts`'s gesture logic, or to
  `TaskDetailPanel` itself (kept as-is for any other current/future caller).
- A backdrop/dimming layer behind the drawer, or focus-trapping inside it
  beyond Escape-to-close — can be revisited if it proves needed in practice.
