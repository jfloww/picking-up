# Daily Task Detail Panel Design

**Date:** 2026-07-21
**Status:** Approved
**Builds on:** `2026-07-21-daily-timetable-shrink-to-fit-design.md`,
`2026-07-21-all-day-zone-above-rail-design.md` (both merged into this
branch, not yet merged to `main`).

## Problem

In the Daily tab, clicking a task's title expands its details (time,
memo, subtasks, delete) inline, directly below that row, in the same
list. For tasks in the rail or All-day zone, this is cramped — the row
list has to make room for the expansion in a narrow column that's
already sharing space with the hour grid.

## Goal

Clicking a task's title in the Daily tab's rail or All-day zone (not the
Weekly column) opens its details in a dedicated panel at the bottom of
the Weekly column instead of expanding inline. The Weekly list shrinks
to make room for the panel (reusing the `ShrinkStack` primitive already
built for the rail/All-day relationship), and the list scrolls internally
once it hits its floor — mirroring the rail's own behavior. Clicking a
Weekly-column task keeps today's inline-expand, unchanged.

## Changes

### 1. Extract `TaskDetailFields` from `TaskItem`

`frontend/src/features/tasks/components/task-detail-fields.tsx` (new):
the form fields currently inside `TaskItem`'s `{open && (...)}` block —
time picker + clear button, memo textarea, `SubtaskList`, delete button —
extracted into their own component, without the outer `mt-1 pl-6`
indent-under-a-row wrapper (each caller applies its own wrapper). Props:
`task`, `onMemoChange`, `onTimeChange`, `onAddSubtask`, `onToggleSubtask`,
`onRemoveSubtask`, `onDelete` — same signatures `TaskItem` already uses.

`TaskItem`'s inline `{open && (...)}` block now wraps `TaskDetailFields`
instead of inlining the fields directly. No behavior change for any
existing caller (Weekly, Monthly, Yearly, and Weekly-column Daily-tab
clicks all keep inline expand exactly as today).

### 2. `TaskItem` gains an optional `onSelect` prop

When provided, the title button calls `onSelect()` instead of toggling
local `open` state:

```tsx
onClick={() => (onSelect ? onSelect() : setOpen((o) => !o))}
```

Since `setOpen` is never called when `onSelect` is provided, `open`
stays `false` and the inline block naturally never renders — no extra
conditional needed. Every other `TaskItem` prop/behavior is unchanged.

### 3. New `TaskDetailPanel` component

`frontend/src/features/tasks/components/task-detail-panel.tsx` (new):
props `task`, `onToggle`, `onClose`, plus the same field-change props
`TaskDetailFields` takes. Renders a small header (checkbox bound to
`onToggle`, the task's title as text, a close (✕) button calling
`onClose`) followed by `TaskDetailFields`. This is what
`ShrinkStack`'s `secondary` slot renders in the Weekly column once a
task is selected.

### 4. `DayTimeline` gains an optional `onSelectTask` prop

`onSelectTask?: (id: string) => void`. Passed to every `TaskItem`
instance in both the timed-chips loop and the All-day loop as
`onSelect={() => onSelectTask?.(t.id)}`. Optional and defaulting to
unused (falls back to `TaskItem`'s normal inline-toggle) so existing
`DayTimeline` tests that don't pass it are unaffected.

### 5. `DailyView` holds selection state and wires the panel

`frontend/src/features/tasks/components/views/daily-view.tsx`: adds
`const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)`
and resolves the live task via the existing tasks store:
`const { tasks } = useTasks(); const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;`
— resolved fresh each render (not a stale snapshot), so edits made
through the panel (including delete) are reflected immediately, and
deleting the selected task naturally clears the panel next render
without extra cleanup code, since `selectedTask` just becomes `null`.

`DayTimeline` gets `onSelectTask={handleSelectTask}`, where
`handleSelectTask` toggles rather than just setting the id — clicking
the same task's title again closes the panel, matching today's
inline-expand toggle behavior:

```tsx
const handleSelectTask = (id: string) =>
  setSelectedTaskId((current) => (current === id ? null : id));
```

The Weekly column renders:
- `selectedTask == null`: `<ScopeTasks .../>` exactly as today.
- `selectedTask != null`: wrapped in `ShrinkStack`, `primary` =
  `<ScopeTasks .../>` (`primaryMinHeight={200}`, no `primaryMaxHeight`
  — see point 6 below), `secondary` = `<TaskDetailPanel
  task={selectedTask} onClose={() => setSelectedTaskId(null)} .../>`.

### 6. `ShrinkStack`'s `primaryMaxHeight` becomes optional

`frontend/src/components/shrink-stack.tsx`: `primaryMaxHeight?: number`.
When omitted, no `maxHeight` style is applied to the `primary` pane — it
grows via `flex-1` to fill available space with no cap, which is what
the Weekly list needs (no natural fixed ceiling, unlike the rail's
12-hour/576px one). The rail's existing usage
(`primaryMaxHeight={VIEWPORT_HEIGHT}`) is unaffected — this is a
widening of the prop's type, not a behavior change for existing callers.

## Data & store

No changes. `selectedTaskId` is local UI state in `DailyView`; all task
mutations continue through the existing store actions.

## Testing

- `task-item.test.tsx`: add tests that `onSelect` (when provided) is
  called on title click instead of toggling inline `open`, and that
  `open` never becomes visible in that mode.
- `task-detail-panel.test.tsx` (new): renders the header (checkbox,
  title, close button) and the field content; `onClose`/`onToggle`
  fire correctly.
- `shrink-stack.test.tsx`: add a test that omitting `primaryMaxHeight`
  renders `primary` with no `maxHeight` inline style, while
  `minHeight` is still applied.
- `day-timeline.test.tsx`: add a test that clicking a rail chip's and
  an All-day row's title calls `onSelectTask` with the right id instead
  of expanding inline, when the prop is provided.
- `daily-view.test.tsx`: integration test for select → panel appears
  with the right task → re-click same task closes it → click a
  different task swaps the panel → deleting the selected task via the
  panel clears the selection.
- Manual browser verification: weekly list visibly shrinks toward its
  floor as the detail panel opens, list scrolls internally once at the
  floor, no scrollbar on the outer Weekly column — same checks as the
  rail's shrink-to-fit verification.

## Out of scope (this iteration)

- Any visual "selected" highlight on the rail chip/All-day row itself
  while its panel is open.
- Making Weekly-column tasks also open the panel — they keep inline
  expand.
- Keyboard shortcuts (e.g. Escape to close the panel).
- Persisting `selectedTaskId` across a date change or page reload.
