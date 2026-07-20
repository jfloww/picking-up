# Calendar UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the Daily tab so the hour rail renders above the All-day
section (untimed tasks no longer sit "at the top"), make the outer page
non-scrollable so only calendar content scrolls, and make task rows bigger,
bolder, and more visually dominant than the hour-rail's gridlines.

**Architecture:** Four small, independent Tailwind-class/JSX-order edits
across three files — no new components, props, state, or data-model
changes. `TaskItem` is the single component every task row renders
through, so its typography change is automatically consistent everywhere.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind CSS 4, Vitest +
Testing Library + jsdom.

## Global Constraints

- No new npm dependencies.
- No component logic, props, or state changes — every step in this plan is
  a Tailwind class edit or a JSX reorder. Do not add new abstractions.
- Preserve every existing `data-testid` attribute exactly as-is (tests
  depend on them) — this plan changes visual classes and element order,
  never test-id values.
- `frontend/src/features/tasks/components/task-item.tsx` already has an
  optional `dateLabel` prop (from the merged weekly-task-rollup feature) —
  don't touch that prop or its rendering block; only the sibling classNames
  change in this plan.
- Test conventions: colocated `*.test.tsx` files, `TasksProvider` +
  `fakeRepository`/`makeTask` from `../test-utils`, fixed system time via
  `vi.setSystemTime(new Date(2026, 6, 16, 14, 5))` where `day-timeline.test.tsx`
  already pins it.
- Test command: run from `frontend/` — `npx vitest run <path>` for a single
  file, `npm test` for the full suite.
- Commit messages: no `Co-Authored-By` trailer needed on per-task commits.

---

### Task 1: `DayTimeline` — rail above All-day, quieter gridlines

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx`
- Modify: `frontend/src/features/tasks/components/day-timeline.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports, no prop changes. `HOUR_HEIGHT` stays exported
  and unchanged. Purely a JSX reorder (hour rail block moves before the
  All-day block) plus one Tailwind class value change (gridline border
  opacity).

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, add this
test inside the existing `describe("DayTimeline", ...)` block, after "on a
non-today date, falls back to a 07:00 scroll start":

```ts
  it("renders the hour rail before the All-day section", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    const rail = screen.getByTestId("hour-rail");
    const allDay = screen.getByTestId("all-day-zone");
    expect(
      rail.compareDocumentPosition(allDay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — today, the All-day block renders first in the JSX, so
`rail.compareDocumentPosition(allDay)` does NOT include
`DOCUMENT_POSITION_FOLLOWING` (it precedes the rail, not follows it).

- [ ] **Step 3: Write the implementation**

Replace the entire `return (...)` block of
`frontend/src/features/tasks/components/day-timeline.tsx` (currently lines
52-147) with:

```tsx
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative overflow-y-auto rounded-md border border-border/60"
        style={{ height: VIEWPORT_HEIGHT }}
      >
        <div className="relative" style={{ height: RAIL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/15"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              <span className="pl-1 text-[10px] tabular-nums text-subtle">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          ))}

          {isToday && (
            <div
              data-testid="now-line"
              className="absolute inset-x-0 z-10 border-t-2 border-brand"
              style={{ top: toOffset(nowTime()) }}
            />
          )}

          {layoutTimedTasks(timed).map(({ task: t, column, columns }) => (
            <div
              key={t.id}
              data-testid={`chip-${t.id}`}
              className="absolute z-20 touch-none rounded-md bg-brand/10 px-1 ring-1 ring-brand/30 focus-within:z-30"
              style={{
                top: toOffset(t.time!),
                left: `calc(${(column / columns) * 100}% + 2px)`,
                width: `calc(${100 / columns}% - 4px)`,
              }}
              {...getDragHandlers(t.id, t.title)}
            >
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}

          {dragState?.previewTime && (
            <div
              data-testid="drag-preview-line"
              className="pointer-events-none absolute inset-x-0 z-40 border-t-2 border-dashed border-brand"
              style={{ top: toOffset(dragState.previewTime) }}
            >
              <span className="bg-brand px-1 text-[10px] text-primary-foreground">
                {dragState.previewTime}
              </span>
            </div>
          )}
        </div>
      </div>

      <div ref={allDayZoneRef} data-testid="all-day-zone">
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          All-day
        </div>
        <div className="space-y-1">
          {allDay.map((t) => (
            <div
              key={t.id}
              data-testid={`all-day-${t.id}`}
              className="touch-none"
              {...getDragHandlers(t.id, t.title)}
            >
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}
        </div>
        <QuickAdd onAdd={(title) => addTask(title, scope)} />
      </div>

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: dragState.pointerX + 12,
          }}
        >
          {dragState.title}
        </div>
      )}
    </div>
  );
```

The only content changes from the current file are: (1) the All-day `<div>`
block now appears after the hour-rail `<div>` block instead of before it,
and (2) the hourly gridline's className changed from
`"absolute inset-x-0 border-t border-border/40"` to `"absolute inset-x-0
border-t border-border/15"`. Everything else (refs, data-testids, drag
handlers, ghost/preview elements) is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (all tests in the file — the reorder doesn't affect any
existing assertion, since every existing test looks up elements by
`data-testid` and mocks `getBoundingClientRect` per element rather than
relying on document order).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: move All-day section below the hour rail, quiet the gridlines"
```

---

### Task 2: Page never scrolls — `main` is the one scroll container

**Files:**
- Modify: `frontend/src/app/app/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no changes to any exported function or component signature —
  `AppPage` stays a server component with the same behavior, only its
  outer `<div>`/`<main>` Tailwind classes change.

There is no existing test file for this page (`page.test.tsx` does not
exist — it's a server component doing an auth fetch, untested at this
layer per this repo's conventions), and jsdom has no real layout/viewport
engine to meaningfully assert scroll-container behavior against, so this
task has no automated test step. Verification is the build (Step 2) plus
the manual browser checklist in Task 4.

- [ ] **Step 1: Write the implementation**

In `frontend/src/app/app/page.tsx`, change the outer wrapper and `main`
classes (currently):

```tsx
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader user={user} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <TaskCalendar />
      </main>

      <SiteFooter />
    </div>
```

to:

```tsx
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <SiteHeader user={user} />

      <main className="mx-auto w-full max-w-6xl min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <TaskCalendar />
      </main>

      <SiteFooter />
    </div>
```

(`min-h-svh` → `h-svh overflow-hidden` fixes the outer wrapper to the
viewport instead of letting it grow past it; `main` gains `min-h-0
overflow-y-auto` so it becomes the scrollable region instead of the page —
`min-h-0` is required here because without it, a flex child won't shrink
below its content's natural height and `overflow-y-auto` would never
actually engage.)

- [ ] **Step 2: Run the build to verify no type errors**

Run (from `frontend/`): `npm run build`
Expected: PASS — this is a plain Tailwind class edit with no logic change,
so this step is a sanity check, not a behavior verification.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/app/page.tsx
git commit -m "feat: contain page scroll to the main content region"
```

---

### Task 3: `TaskItem` — bigger, bolder task rows

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no prop or export changes — `TaskItem`'s signature (including
  the existing `dateLabel?: string` prop) is untouched. Only two Tailwind
  className values change on the collapsed row.

No existing test asserts the specific classNames being changed (confirmed:
no test file references `"text-sm"` or `"items-center gap-2"` for this
component), so this task adds no new test code — run the existing suite to
confirm nothing else depends on the old sizing.

- [ ] **Step 1: Write the implementation**

In `frontend/src/features/tasks/components/task-item.tsx`, change the
collapsed row's outer `<div>` (currently line 63,
`<div className="flex items-center gap-2">`) to add vertical padding:

```tsx
      <div className="flex items-center gap-2 py-1.5">
```

Then change the title `<button>`'s className (currently lines 80-83):

```tsx
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm",
            task.done && "text-muted-foreground line-through",
          )}
```

to:

```tsx
          className={cn(
            "min-w-0 flex-1 truncate text-left text-base font-medium",
            task.done && "text-muted-foreground line-through",
          )}
```

Every other line in the file (the `dateLabel` block, the time badge, the
subtask badge, the rolled-over icon, the expanded editor section) stays
exactly as it is.

- [ ] **Step 2: Run the full test suite to verify nothing broke**

Run (from `frontend/`): `npm test`
Expected: PASS, all files — `TaskItem` renders through many call sites
(All-day zone, rail chips, Weekly Task list, Weekly/Monthly view cells), so
running the full suite (not just one file) is the right check here.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/tasks/components/task-item.tsx
git commit -m "feat: increase task title size/weight and row padding"
```

---

### Task 4: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run (from `frontend/`): `npm test`
Expected: PASS, all files.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no new warnings.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual browser verification checklist**

Start the dev server (`npm run dev`) and, on `/app`:

1. Confirm the Daily tab shows the hour rail (Time Table) first, with the
   All-day section below it.
2. Confirm dragging still works both directions (all-day↔rail) with the
   sections in their new order.
3. Resize the browser window shorter than the page's natural content
   height (or zoom in) and confirm the browser/page itself never shows a
   scrollbar — only the calendar content area scrolls internally. Confirm
   the header and footer stay visible/fixed while the middle scrolls.
4. Confirm the hour rail's own internal 12-hour scroll still works
   independently (scrolling within the rail doesn't scroll the outer page,
   and vice versa).
5. Confirm task titles read noticeably larger/bolder than before, and that
   the hour gridlines are visibly quieter — tasks should read as the
   dominant visual element, not the grid.
6. Spot-check the Weekly Task column, Weekly view, and Monthly view to
   confirm task rows there also picked up the larger/bolder title (since
   they all render through `TaskItem`), and nothing looks clipped or
   overlapping at the new row height.

- [ ] **Step 5: Report status**

If all checks pass, the branch is ready to push. If any manual check fails,
stop and report which one before proceeding — do not attempt an ad hoc fix
outside this plan's task boundaries.
