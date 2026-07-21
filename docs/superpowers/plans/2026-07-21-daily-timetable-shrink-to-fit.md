# Daily Timetable Shrink-to-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Daily tab's hour rail (time table) shrink toward a floor of half its height as tasks are added to the All-day zone below it, so the outer Day column never needs to scroll — only the two panels' own internal content does.

**Architecture:** A new generic, reusable layout primitive, `ShrinkStack`, implements the "priority pane shrinks to a floor, second pane absorbs the rest and scrolls internally" pattern via pure CSS flexbox (`flex-1` + explicit `min-height`/`max-height`, plus a `calc()`-based cap on the second pane) — no JS measurement, no `ResizeObserver`. `DayTimeline` is refactored to render its existing hour-rail and All-day-zone JSX through `ShrinkStack` instead of via hardcoded inline/Tailwind height caps.

**Tech Stack:** Next.js/React (TypeScript), Tailwind CSS, Vitest + `@testing-library/react`.

## Global Constraints

- No new npm dependencies — pure CSS flexbox only (per spec Approach A: `docs/superpowers/specs/2026-07-21-daily-timetable-shrink-to-fit-design.md`).
- Shared components use the `@/components/...` import alias (see `frontend/src/app/app/page.tsx:1-2` for the established pattern), not relative paths.
- Frontend tests run via `npm test` (`vitest run`) from `frontend/`; a single file can be targeted with `npx vitest run <path>`.
- `ShrinkStack` must stay domain-agnostic (no Daily-tab-specific naming or logic) — it's a generic two-pane primitive, reusable by future pages without modification.

---

### Task 1: `ShrinkStack` layout primitive

**Files:**
- Create: `frontend/src/components/shrink-stack.tsx`
- Test: `frontend/src/components/shrink-stack.test.tsx`

**Interfaces:**
- Produces: `ShrinkStack` React component, props:
  ```ts
  type ShrinkStackProps = {
    primary: React.ReactNode;
    primaryMinHeight: number; // px floor for the primary pane
    primaryMaxHeight: number; // px ceiling for the primary pane
    secondary: React.ReactNode;
    gap?: number; // px, default 6
  };
  ```
  Renders two wrapper `div`s with `data-testid="shrink-stack-primary"` and `data-testid="shrink-stack-secondary"`. Task 2 consumes this component and these prop names directly.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/shrink-stack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShrinkStack } from "./shrink-stack";

describe("ShrinkStack", () => {
  it("bounds the primary pane between its min and max height", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={288}
        primaryMaxHeight={576}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    expect(primary.style.minHeight).toBe("288px");
    expect(primary.style.maxHeight).toBe("576px");
  });

  it("caps the secondary pane to the space remaining above the primary's floor", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={288}
        primaryMaxHeight={576}
        secondary={<div>Secondary content</div>}
        gap={6}
      />,
    );
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(secondary.style.maxHeight).toBe("calc(100% - 288px - 6px)");
  });

  it("defaults gap to 6px when not provided", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    expect(screen.getByTestId("shrink-stack-secondary").style.maxHeight).toBe(
      "calc(100% - 100px - 6px)",
    );
  });

  it("renders the primary and secondary content passed in", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    expect(screen.getByText("Primary content")).toBeTruthy();
    expect(screen.getByText("Secondary content")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/components/shrink-stack.test.tsx`
Expected: FAIL — `Cannot find module './shrink-stack'` (component doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/components/shrink-stack.tsx`:

```tsx
import type { ReactNode } from "react";

type ShrinkStackProps = {
  primary: ReactNode;
  primaryMinHeight: number;
  primaryMaxHeight: number;
  secondary: ReactNode;
  gap?: number;
};

export function ShrinkStack({
  primary,
  primaryMinHeight,
  primaryMaxHeight,
  secondary,
  gap = 6,
}: ShrinkStackProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ gap }}>
      {/* overflow-hidden makes the flex auto-minimum-size algorithm honor
          minHeight as a real floor instead of growing to fit tall content */}
      <div
        data-testid="shrink-stack-primary"
        className="min-h-0 flex-1 overflow-hidden"
        style={{ minHeight: primaryMinHeight, maxHeight: primaryMaxHeight }}
      >
        {primary}
      </div>
      <div
        data-testid="shrink-stack-secondary"
        className="shrink-0 overflow-hidden"
        style={{ maxHeight: `calc(100% - ${primaryMinHeight}px - ${gap}px)` }}
      >
        {secondary}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/shrink-stack.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shrink-stack.tsx frontend/src/components/shrink-stack.test.tsx
git commit -m "feat: add ShrinkStack layout primitive"
```

---

### Task 2: Wire `ShrinkStack` into `DayTimeline`

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx:1-153`
- Modify: `frontend/src/features/tasks/components/day-timeline.test.tsx`

**Interfaces:**
- Consumes: `ShrinkStack` from `@/components/shrink-stack` (Task 1) with props `primary`, `primaryMinHeight`, `primaryMaxHeight`, `secondary`, and `data-testid="shrink-stack-primary"`/`"shrink-stack-secondary"` on its rendered wrappers.
- No new exports from `day-timeline.tsx` — `HOUR_HEIGHT` stays exported as today; `VIEWPORT_HEIGHT`/`VIEWPORT_HOURS`/`RAIL_HEIGHT` stay local, unchanged in value.

- [ ] **Step 1: Write the failing test**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, add this test inside the existing `describe("DayTimeline", ...)` block (after the `"renders the hour rail before the All-day section"` test, i.e. after line 81):

```tsx
  it("bounds the rail between a 6h floor and its 12h viewport via ShrinkStack", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    const primaryPane = screen.getByTestId("shrink-stack-primary");
    expect(primaryPane.style.minHeight).toBe(`${6 * HOUR_HEIGHT}px`);
    expect(primaryPane.style.maxHeight).toBe(`${12 * HOUR_HEIGHT}px`);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="shrink-stack-primary"]` (rail isn't wrapped in `ShrinkStack` yet).

- [ ] **Step 3: Wire `ShrinkStack` into `DayTimeline`**

In `frontend/src/features/tasks/components/day-timeline.tsx`:

1. Add the import (after line 3, before the relative imports on line 5):

```tsx
import { ShrinkStack } from "@/components/shrink-stack";
```

2. Replace the entire `return` statement (lines 53–152) with:

```tsx
  return (
    <>
      <ShrinkStack
        primary={
          <div
            ref={railRef}
            data-testid="hour-rail"
            className="relative h-full overflow-y-auto rounded-md border border-border/60"
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
        }
        primaryMinHeight={VIEWPORT_HEIGHT / 2}
        primaryMaxHeight={VIEWPORT_HEIGHT}
        secondary={
          <div
            ref={allDayZoneRef}
            data-testid="all-day-zone"
            className="flex h-full flex-col"
          >
            <div className="mb-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wide text-subtle">
              All-day
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
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
        }
      />

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
    </>
  );
```

Note what changed on the two inner panes versus the original: the rail `div` drops `min-h-0 flex-1` and the inline `style={{ maxHeight: VIEWPORT_HEIGHT }}`, gaining `h-full` instead (sizing now comes from `ShrinkStack`'s wrapper). The All-day zone `div` drops `max-h-32 shrink-0`, gaining `h-full` instead. Everything else (refs, test ids, drag handlers, inner scroll region on the task-row list, `QuickAdd`) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS — no other suite references `VIEWPORT_HEIGHT`, `max-h-32`, or the rail's old inline `maxHeight` style (confirmed via repo-wide search during planning), so no other test should be affected.

- [ ] **Step 6: Manual browser verification**

Start the dev server (`npm run dev` from `frontend/`), open the Daily tab, and add several All-day tasks:
- Confirm the hour rail visibly shrinks as tasks are added, stopping once it reaches roughly half its original height (6 hours' worth of gridlines instead of 12).
- Confirm that once the rail stops shrinking, additional tasks scroll within the All-day task list itself — the "All-day" label and the add-task input stay visible/pinned, and no scrollbar appears on the outer Day column.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: shrink the daily rail to a 6h floor as All-day tasks grow"
```
