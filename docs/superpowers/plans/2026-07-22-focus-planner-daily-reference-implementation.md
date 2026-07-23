# Focus Planner Daily Reference Implementation Plan

**Status:** Implemented on 2026-07-22.

**Design source:** Superdesign project `878185a1-e629-4147-be3e-964cb6849920`, draft `328ffbe2-d400-46de-b36e-6c6c716ad591` (v4), exported to `focus-planner-reference.html`.

## Goal

Apply the approved Focus Planner visual hierarchy to the existing Daily tab while preserving the current Next.js/React architecture, task model, repository, provider/reducer actions, drag-to-schedule behavior, task editing, and drawer interactions.

The HTML is a visual/layout reference only. Do not copy its inline JavaScript, CDN dependencies, mock task data, Inter font import, or standalone page shell.

## Existing behavior already aligned

- `DailyView` already uses a `3fr / 2fr` (60/40) split.
- `DayAgenda` already groups tasks as `All Day To-Do`, `Next Up`, and `Done Today`.
- There is no header-level New Task button.
- Daily already owns a single quick-add control below the scrollable agenda content.
- Task selection already opens a fixed right-side drawer, and drag-to-schedule already works in both directions.

The implementation should therefore be a presentation-focused refinement, not a rewrite.

## Scope boundaries

- Daily tab only. Do not redesign `weekly-view.tsx`, `monthly-view.tsx`, `yearly-view.tsx`, or their tests.
- Do not change `Task`, `Scope`, the task repository, storage format, `TasksProvider`, reducer actions, date logic, or API/auth code.
- Keep `SiteHeader`, `SiteFooter`, `RootLayout`, Geist, and the existing light/dark theme behavior.
- Reuse semantic tokens from `globals.css`; do not add a second token system or hardcode the reference's literal palette throughout components.
- Do not invent duration data. The current `Task` model has a start time but no duration, so the reference's `Planned 3h 15m` and `(60m)` values must be omitted. A timed-task count may be derived without changing the model.

## Affected files and implementation steps

### 1. Lock the Daily layout contract with tests

**Tests:**
- `frontend/src/features/tasks/components/views/daily-view.test.tsx`
- `frontend/src/features/tasks/components/day-agenda.test.tsx`

Add assertions that:

- the Daily root keeps the 60/40 desktop split;
- the timeline and agenda remain full-height siblings with independent overflow;
- only the agenda task list scrolls while the bottom `New task` action remains mounted and visible;
- the existing task drawer and all drag-to-schedule paths still work;
- no Daily header-level New Task action is introduced.

### 2. Refine the Daily two-panel shell

**Modify:** `frontend/src/features/tasks/components/views/daily-view.tsx`

- Keep the current component tree and refs.
- Restyle the two-column container to read as one fixed workspace: 60% timeline, 40% agenda, subtle divider, no card gap that breaks the shared-canvas treatment.
- Keep `min-h-0`, full-height containment, drag ghost, selection state, and `TaskDetailDrawer` wiring unchanged.
- Use existing semantic classes such as `bg-background`, `bg-card`, `bg-muted`, `border-border`, `text-subtle`, and `text-brand`.

### 3. Apply the Focus Agenda treatment to the timeline

**Modify:**
- `frontend/src/features/tasks/components/day-timeline.tsx`
- `frontend/src/features/tasks/components/day-timeline.test.tsx`

- Add a non-scrolling panel header with `Focus Agenda` and a derived count of timed tasks for the selected date.
- Keep the current 24-hour rail, auto-scroll behavior, `HOUR_HEIGHT`, overlap layout, now line, and drag preview calculations intact.
- Move the scrolling rail below the header and use the reference's restrained hour-grid, left time gutter, surface hierarchy, and tabular time treatment through existing tokens.
- Restyle existing task chips rather than replacing `TaskItem` or creating reference-only mock blocks.
- Preserve checkbox completion, title selection, overdue/pending states, priority/subtask indicators, and pointer handlers.

### 4. Restyle agenda sections and pin the Daily CTA

**Modify:**
- `frontend/src/features/tasks/components/day-agenda.tsx`
- `frontend/src/features/tasks/components/quick-add.tsx`
- `frontend/src/features/tasks/components/task-item.tsx`
- `frontend/src/features/tasks/components/day-agenda.test.tsx`
- `frontend/src/features/tasks/components/primitives.test.tsx`

- Keep the existing filters and sorting for all-day, timed unfinished, and completed tasks.
- Present section labels in the reference's compact uppercase hierarchy and add derived counts where useful.
- Keep completed tasks visually subdued and retain current overdue/pending semantics.
- Give `QuickAdd` an optional Daily footer presentation (for example, `variant="panel-footer"`) that shows a persistent plus icon and `New task` label at the lower-left, then supports the same trimmed Enter-to-submit behavior. Keep its default presentation unchanged for Weekly, Monthly/Yearly scope lists, and subtasks.
- Refine the existing `TaskItem` large/Daily presentation to the compact reference density. Keep the default compact presentation unchanged for non-Daily consumers.
- Continue using the existing `Checkbox`, Lucide icons, handler builder, and accessibility labels.

### 5. Align the Daily task drawer without affecting Weekly

**Modify:**
- `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- `frontend/src/features/tasks/components/task-detail-fields.tsx` only if a drawer-specific presentation prop is needed
- `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`

- Match the reference's approximately 400px fixed drawer, 72px header, separated scroll body, and bottom action area using existing tokens.
- Keep the current live form controls for time, repeat, priority, memo, subtasks, completion, and deletion; do not replace them with static reference text.
- Preserve Escape close, close button, task switching, delete cleanup, and slide transition.
- If `TaskDetailFields` needs different spacing inside the drawer, add an optional drawer variant and leave the default unchanged so `TaskDetailPanel` in Weekly retains its current behavior and design.

### 6. Preserve shared calendar and non-Daily views

**Verify without visual changes:**
- `frontend/src/features/tasks/components/task-calendar.tsx`
- `frontend/src/features/tasks/components/view-switcher.tsx`
- `frontend/src/features/tasks/components/views/weekly-view.tsx`
- `frontend/src/features/tasks/components/views/monthly-view.tsx`
- `frontend/src/features/tasks/components/views/yearly-view.tsx`

The existing date navigation, tab switching, initial view, and non-Daily rendering stay unchanged. The design reference's Weekly markup is intentionally deferred.

## Verification after implementation

From `frontend/` run:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Then manually verify at the project's current desktop viewport:

1. Daily shows the fixed 60/40 timeline/agenda workspace.
2. Long agenda content scrolls without moving the lower-left `New task` CTA.
3. Adding, completing, selecting, editing, deleting, prioritizing, repeating, and adding subtasks still work.
4. Agenda-to-rail, rail-to-agenda, and rail-to-rail dragging still work.
5. The drawer opens, switches tasks, closes via button/Escape, and overlays without resizing the two panels.
6. Weekly, Monthly, and Yearly look and behave exactly as before.
7. Both dark and light themes remain usable with the current Geist typography and semantic tokens.

## Implementation verification

- A follow-up visual-fidelity pass made Daily the initial view (confirmed as the intended, permanent behavior — superseding the "do not force Daily to become the default tab" scope boundary originally drafted above) and integrated the reference's date/tab/navigation bar inside the planner body. The existing `/app` `SiteHeader`, `SiteFooter`, and authenticated user controls remain unchanged around it. The page container's max width was later widened from `max-w-6xl` to `max-w-[1600px]`.
- The Daily timeline now uses the reference's 64px hour rhythm, wide gutter, planned summary, border-left task chips, and 12-hour card time labels while preserving drag calculations and automatic scroll behavior.
- The agenda now uses 40px content padding, reference-sized two-line cards, neutral future-task styling, a stronger checkbox outline, and a pinned 24px footer CTA.
- The implementation was visually compared to the exported Superdesign HTML at 1440×900; the temporary preview route and screenshots were removed afterward.
- Focus Planner tests: 47 passed.
- `primitives.test.tsx` excluding `excludes a day-scoped task dated excludeDate`: 37 passed, 1 skipped.
- Full regression run excluding only that pre-existing assertion: 257 passed, 1 skipped across 23 files.
- `npm run lint`: passed with existing unused-parameter warnings in test fixtures.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed in an isolated temporary build directory because the active dev server held the normal `.next/trace` file open.
