# Picking Up Design System

## Product context

Picking Up is a calm task planner whose current production workspace is `/planner`. It is built around Daily, Weekly, and Monthly calendar scales; Bucket List exists in the codebase but is temporarily hidden from navigation. One task data model supports completion, time scheduling, priority, repeat rules, subtasks, drag-to-schedule, and task details. The desktop experience is established; mobile web is a new responsive target that must preserve those capabilities without compressing the desktop layout.

## Visual direction

- Quiet, high-density productivity UI with restrained hierarchy.
- Default dark theme uses near-black canvas and charcoal surfaces with warm gold as the focus/brand accent. Light mode uses muted blue.
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
- Dark brand/focus: `#d4a85f` (warm gold), matching the current CSS tokens and approved desktop reference.
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
- The brand wordmark is text-only: `PICKING UP`, with `UP` in the brand color. Never invent a leading symbol, monogram, logo icon, blue mark, or gradient treatment.
- Calendar navigation is owned by `TaskCalendar` and `ViewSwitcher`; mobile may reorganize those controls while preserving their states and actions.
- Daily content is owned by `DailyView`, with `DayTimeline` on the left, `DayAgenda` on the right, and `TaskDetailDrawer` as an overlay.
- `DayAgenda` groups tasks into All Day To-Do, Next Up, and Done Today and owns the single quick-add entry for the Daily view.
- Preserve the task store, repository, types, reducer/actions, and drag scheduling hooks; redesign only rendering and layout around those contracts.

## Mobile web structure

- Target a 390px-wide mobile viewport first, with safe-area-aware fixed or sticky controls and 16px page gutters.
- Superdesign mobile-flow drafts must use an explicit 390 × 844 custom artboard. Do not inherit a desktop canvas device, stretch the app to desktop width, or place the UI inside a decorative phone/browser mockup.
- Remove the marketing-style site footer from the active planner viewport on mobile; keep account, theme, and secondary links available from a compact overflow/profile menu.
- Keep Daily, Weekly, and Monthly as the primary app-level destinations. On mobile, use a persistent bottom navigation for them rather than squeezing desktop tabs into the header.
- Daily is agenda-first. Replace the desktop 60/40 simultaneous panes with a local `Tasks / Timeline` segmented switch; preserve the selected date across the switch.
- Put date navigation in a compact sticky header: previous day, date/title, Today, and next day. Support horizontal date swiping as an enhancement, never as the only control.
- The preferred first structure adds a compact seven-day date strip beneath the week controls, with the active date clearly selected; it must not make explicit previous/Today/next navigation disappear.
- Keep `+ New task` persistently reachable above the app navigation. The keyboard may turn it into an inline composer; it must not be hidden at the end of a long list.
- Open task details as a full-height mobile sheet/page with a sticky top close action and sticky bottom Cancel/Done actions. Do not use a 420px side drawer at narrow widths.
- Preserve explicit time/date controls so scheduling never depends on cross-pane drag. Timeline drag may remain as a progressive enhancement for touch devices.
- Weekly becomes a vertically scrollable seven-day list or day carousel, not seven simultaneous narrow columns. Monthly uses the existing mobile list concept with week dividers and opens a full-height day agenda.
- Touch targets should be at least 44px where possible; do not rely on hover-only actions. Destructive and secondary row actions should move to an overflow menu or swipe action with an accessible alternative.

## Daily approved-reference constraints

- Treat Superdesign draft `328ffbe2-d400-46de-b36e-6c6c716ad591` and its exported HTML as visual/layout references only.
- Do not copy inline JavaScript or replace the application with standalone HTML.
- Keep the timeline/task-list split at 60/40.
- Keep the right-side label exactly `All Day To-Do`.
- Do not introduce a header-level New Task action.
- Keep the Daily `+ New task` entry persistently visible at the lower-left of the right panel while its task sections scroll.
- Keep task selection, drawer, completion, edit, repeat, subtask, priority, deletion, and drag-to-schedule interactions intact.
- Desktop Weekly, Monthly, and Yearly redesign remains out of scope for the Daily reference.
- The approved mobile-only Weekly stacked agenda and Monthly date-list/day-agenda flow are implemented as responsive branches; they must not alter their established desktop layouts.
