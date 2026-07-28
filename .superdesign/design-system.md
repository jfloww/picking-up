# Picking Up Design System

## Product context

Picking Up is a calm, desktop-first task planner built around Daily, Weekly, Monthly, and Yearly calendar scales. The main `/app` workspace preserves one task data model and supports task completion, time scheduling, priority, repeat rules, subtasks, drag-to-schedule, and task details. Daily is the current redesign target; the other views must keep their behavior and established component patterns.

## Visual direction

- Quiet, high-density productivity UI with restrained hierarchy.
- Default dark theme uses near-black canvas and charcoal surfaces with steel-blue as the focus/brand accent (matching light theme's blue, not the earlier gold exploration — see Color below).
- Light theme remains neutral white and cool gray with muted blue brand/focus.
- Use borders and 1px rings for separation. Reserve large shadows for overlays such as the task drawer.
- Avoid decorative gradients, new font families, saturated novelty colors, glass effects, or marketing-style ornament inside the planner.

## Tokens

### Typography
- Family: Geist via `--font-sans`; headings also resolve to Geist.
- Dense labels: 10–13px, often uppercase or semibold when marking sections.
- Controls/body: 13–16px.
- Workspace date heading: 18–20px, semibold/bold.
- Use tabular numerals for times, counts, and durations.

### Color

Source of truth: `frontend/src/app/globals.css`. If this doc and that file
ever disagree, `globals.css` wins — update this section to match, not the
other way around.

- Dark canvas: `#0a0b0c` (`background`).
- Dark raised surface: `#121518` (`card`, `sidebar`, `popover`).
- Dark secondary surface: `#181c20` (`muted`, `secondary`, `accent`, `input`).
- Dark foreground: `#f4f5f6`; muted foreground `#a3adb7`; subtle `#697681`.
- Dark brand/focus: `#6f9cc4` (steel-blue — matches light theme's blue; an
  earlier "Neural Noir" exploration used a warm gold, `#d4a85f`, but that
  was reverted and is no longer current anywhere in the app).
- Dark border: `rgb(255 255 255 / 9%)`.
- Dark destructive: `#ff8a7a`; warning: `#fbbf24` (pending/overdue
  highlighting only — not the brand accent); success: `#4ade80`.
- Light canvas/surface: `#ffffff`; foreground `#171a1c`; secondary `#f2f3f4`;
  muted text `#5f6a72`; border `#e5e7e6`; brand/focus `#3b6b96`; subtle
  `#8b9299`; destructive `#b42318`; warning `#b45309`; success `#15803d`.
- Use semantic Tailwind aliases (`bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-subtle`, `text-brand`, `border-border`, `ring-ring`) instead of duplicating literal values in application code.

### Shape and spacing
- Base radius: 10px. Compact planner items may use 6–10px; cards use 10–14px; pills use full radius only where already established.
- Primary page gutters: 24px, increasing to 40px at `sm` in shared shell regions.
- Planner content max width is currently `max-w-6xl`; compact internal gaps use 4–16px.
- Preserve a 60/40 split for the Daily timeline and task list at the supported desktop viewport.

### Motion and elevation
- Control state transitions use Tailwind color/all transitions.
- Drawer motion: 200ms ease-out horizontal transform.
- Drag ghost: `shadow-lg`; task detail drawer: `shadow-2xl`.
- Do not add motion that changes task behavior or delays core actions.

## Component patterns

- Use the existing shadcn/Base UI primitives under `frontend/src/components/ui`.
- Use Lucide React icons already present in the app; do not add icon CDNs or inline scripts.
- Calendar navigation is owned by `TaskCalendar` and `ViewSwitcher`.
- Daily content is owned by `DailyView`, with `DayTimeline` on the left, `DayAgenda` on the right, and `TaskDetailDrawer` as an overlay.
- `DayAgenda` groups tasks into All Day To-Do, Next Up, and Done Today and owns the single quick-add entry for the Daily view.
- Preserve the task store, repository, types, reducer/actions, and drag scheduling hooks; redesign only rendering and layout around those contracts.

## Daily approved-reference constraints

- Treat Superdesign draft `328ffbe2-d400-46de-b36e-6c6c716ad591` and its exported HTML as visual/layout references only.
- Do not copy inline JavaScript or replace the application with standalone HTML.
- Keep the timeline/task-list split at 60/40.
- Keep the right-side label exactly `All Day To-Do`.
- Do not introduce a header-level New Task action.
- Keep the Daily `+ New task` entry persistently visible at the lower-left of the right panel while its task sections scroll.
- Keep task selection, drawer, completion, edit, repeat, subtask, priority, deletion, and drag-to-schedule interactions intact.
- Weekly implementation is deferred. Monthly and Yearly behavior and presentation are out of scope.
