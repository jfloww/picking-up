# Daily Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Daily tab focus on a single day (dropping the 7-day peek-column
window that lets an in-progress drag accidentally flip the focused day), and give
the Time Table a taller, now-centered default scroll position.

**Architecture:** `DailyView` goes from a `windowAround`-driven 7-cell grid to a
fixed 2-column grid (`DayTimeline` | week `ScopeTasks`). The toolbar's Prev/Next
steps by 1 day instead of 7 for this view. `DayTimeline`'s hour rail grows to a
fixed 12-hour viewport and auto-scrolls to center "now" on today. Two now-dead
date-math functions (`windowAround`, `weekdayOf`) are removed once their last
caller is gone.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind CSS 4, Vitest +
Testing Library + jsdom, `vi.useFakeTimers({ toFake: ["Date"] })` for clock-pinned
tests.

## Global Constraints

- No new npm dependencies.
- `frontend/src/features/tasks/components/task-item.tsx` and
  `frontend/src/features/tasks/components/use-drag-to-schedule.ts` are explicitly
  **out of scope** — do not modify them. The drag mechanics are unchanged; only
  their container layout changes.
- Follow existing test conventions: colocated `*.test.tsx`/`*.test.ts` files,
  `TasksProvider` + `fakeRepository`/`makeTask` from `../test-utils` (or
  `../../test-utils` from a `views/` file), fixed system time via
  `vi.setSystemTime(new Date(2026, 6, 16, 14, 5))` (Thu 2026-07-16 14:05) where a
  test depends on "today".
- Test command: run from `frontend/` — `npx vitest run <path>` for a single file,
  `npm test` for the full suite.
- Commit messages: no `Co-Authored-By` trailer needed per-task; the final task's
  summary will note the convention if a PR is opened later.

---

### Task 1: Toolbar Prev/Next steps by 1 day in the Daily view

**Files:**
- Modify: `frontend/src/features/tasks/components/task-calendar.tsx:20-27`
- Test: `frontend/src/features/tasks/components/task-calendar.test.tsx:6-10`

**Interfaces:**
- Consumes: `addDays(dateKey: string, n: number): string` from
  `frontend/src/features/tasks/lib/dates.ts` (already imported in
  `task-calendar.tsx`, unchanged).
- Produces: `shiftAnchor(view: ViewKind, anchor: string, dir: 1 | -1): string` —
  same signature, only the `"daily"` case's behavior changes. No other task
  depends on this function's internals.

- [ ] **Step 1: Update the failing test**

Replace the `"daily pages by week"` test in
`frontend/src/features/tasks/components/task-calendar.test.tsx` (lines 7-10):

```ts
  it("daily pages by one day", () => {
    expect(shiftAnchor("daily", "2026-07-16", 1)).toBe("2026-07-17");
    expect(shiftAnchor("daily", "2026-07-16", -1)).toBe("2026-07-15");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: FAIL — `shiftAnchor("daily", "2026-07-16", 1)` currently returns
`"2026-07-23"`, not `"2026-07-17"`.

- [ ] **Step 3: Update the implementation**

In `frontend/src/features/tasks/components/task-calendar.tsx`, change the
`"daily"` case of `shiftAnchor` (currently `return addDays(anchor, 7 * dir);`):

```ts
    case "daily":
      return addDays(anchor, dir);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: PASS (all tests in the file, including the unchanged `"weekly"` and
`"monthly and yearly"` cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/task-calendar.tsx frontend/src/features/tasks/components/task-calendar.test.tsx
git commit -m "fix: daily view prev/next steps by one day, not one week"
```

---

### Task 2: Rewrite DailyView as a single-day, 2-column layout

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx` (full rewrite)
- Modify: `frontend/src/features/tasks/components/views/daily-view.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `CalendarViewProps` (`{ anchor: string; onAnchorChange: (dateKey: string) => void }`)
  from `./weekly-view.tsx` (unchanged, already exported). `weekStartOf`,
  `dayLabel` from `../../lib/dates.ts` (unchanged). `DayTimeline` from
  `../day-timeline.tsx` (unchanged in this task — its internals change in
  Task 4). `ScopeTasks` from `../scope-tasks.tsx` (unchanged; used exactly as
  the "Weekly" cell already was, with `scope={{ kind: "week", weekStart }}`
  and `quickAdd`).
- Produces: `DailyView({ anchor, onAnchorChange }: CalendarViewProps)` — same
  export name and prop type as before, so `task-calendar.tsx`'s
  `VIEW_COMPONENTS.daily = DailyView` wiring needs no changes. `onAnchorChange`
  is accepted (required by the shared prop type) but no longer called from
  inside `DailyView` — the toolbar (Task 1) is now the only way to change the
  focused day while in the Daily view.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of
`frontend/src/features/tasks/components/views/daily-view.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
});
afterAll(() => {
  vi.useRealTimers();
});

function renderView(onAnchorChange = vi.fn()) {
  render(
    <TasksProvider repository={fakeRepository()}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("DailyView v3 (single-day layout)", () => {
  it("renders the day heading and no neighboring-day cells", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
    );
    // v2's peek columns rendered neighbor days as "Mo 13" / "Tu 14" / etc.
    // buttons; the redesign drops them entirely.
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the day's timeline and the week's task list side by side", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("Weekly")).toBeTruthy();
    // one quick-add for the timeline's all-day section, one for the weekly cell
    expect(screen.getAllByLabelText("Add task")).toHaveLength(2);
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — the current `DailyView` still renders neighbor-day buttons, so
the first test's length-0 assertion fails.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of
`frontend/src/features/tasks/components/views/daily-view.tsx`:

```tsx
"use client";

import { dayLabel, weekStartOf } from "../../lib/dates";
import { DayTimeline } from "../day-timeline";
import { ScopeTasks } from "../scope-tasks";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{dayLabel(anchor)}</h2>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
          <DayTimeline date={anchor} />
        </div>
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
          <div className="mb-1 text-xs font-semibold">Weekly</div>
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
```

Note: the function still declares its prop type as the full `CalendarViewProps`
(so the call site in `task-calendar.tsx` continues to type-check unchanged) but
only destructures `anchor` — `onAnchorChange` is accepted and ignored, which is
valid TypeScript/React and produces no unused-variable lint error since it's
never bound to a name.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/views/daily-view.tsx frontend/src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: redesign Daily tab as a single-day, two-column layout"
```

---

### Task 3: Remove dead date-math helpers (`windowAround`, `weekdayOf`)

**Files:**
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Test: `frontend/src/features/tasks/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only deletes code. Confirmed by Task 2's
  rewrite that `daily-view.tsx` was the only non-test caller of both
  `windowAround` and `weekdayOf`; `weekly-view.tsx` indexes `DAY_LABELS`
  directly by number and never calls `weekdayOf`.

This is a dead-code removal, not new behavior — there's no red state to drive
it through TDD. Instead: confirm the baseline passes, delete the code and its
tests together, then confirm the suite still passes.

- [ ] **Step 1: Confirm the baseline passes**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: PASS (this is the pre-change baseline).

- [ ] **Step 2: Remove the now-invalid imports and tests**

In `frontend/src/features/tasks/lib/dates.test.ts`:

1. Remove `weekdayOf` and `windowAround` from the import list (currently lines
   15 and 18 of the `from "./dates"` import).
2. Replace the entire `describe("window and day labels", ...)` block (the
   block containing the `windowAround` and `weekdayOf` tests, plus the
   `dayLabel` test) with:

```ts
describe("dayLabel", () => {
  it("formats a full day heading", () => {
    expect(dayLabel("2026-07-16")).toBe("Thursday, July 16");
  });
});
```

(`dayLabel` stays in the import list — it's still used by `daily-view.tsx`.)

- [ ] **Step 3: Remove the dead functions**

In `frontend/src/features/tasks/lib/dates.ts`, delete the `windowAround`
function (currently):

```ts
export function windowAround(anchor: string, radius = 3): string[] {
  return Array.from({ length: radius * 2 + 1 }, (_, i) =>
    addDays(anchor, i - radius),
  );
}
```

and the `weekdayOf` function (currently):

```ts
export function weekdayOf(dateKey: string): number {
  return parse(dateKey).getDay();
}
```

- [ ] **Step 4: Run the full test suite to verify nothing else references them**

Run: `npm test` (from `frontend/`)
Expected: PASS — 0 references to `windowAround`/`weekdayOf` remain anywhere
(confirmed already by the Task 2 rewrite and the earlier grep of the codebase).
If this fails with an import error, grep the repo for the removed name before
proceeding — do not re-add the function speculatively.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/lib/dates.ts frontend/src/features/tasks/lib/dates.test.ts
git commit -m "chore: remove windowAround/weekdayOf, dead since the Daily tab redesign"
```

---

### Task 4: Time Table — 12-hour viewport, now-centered default scroll

**Files:**
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx:13-36`
- Test: `frontend/src/features/tasks/components/day-timeline.test.tsx:59-63`

**Interfaces:**
- Consumes: `toOffset(time: string): number` and `nowTime(): string` (both
  already defined/imported in `day-timeline.tsx`, unchanged).
- Produces: `HOUR_HEIGHT` export unchanged (still `48`). New internal constants
  `VIEWPORT_HOURS = 12` and `VIEWPORT_HEIGHT = VIEWPORT_HOURS * HOUR_HEIGHT`
  (`576`) are not exported — nothing outside this file needs them; tests
  compute the same values from `HOUR_HEIGHT` directly.

- [ ] **Step 1: Update the failing test**

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, replace the
`"defaults the rail scroll to 07:00"` test (lines 59-63) with two tests:

```ts
  it("on today, centers the rail scroll on the current time within a 12h viewport", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    // system time is 14:05 -> now offset = 845min * (48/60) = 676px
    // viewport is 12h = 576px, so centered scrollTop = 676 - 288 = 388
    expect(screen.getByTestId("hour-rail").scrollTop).toBe(388);
  });

  it("on a non-today date, falls back to a 07:00 scroll start", async () => {
    renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("hour-rail").scrollTop).toBe(7 * HOUR_HEIGHT);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — the current implementation always scrolls to
`7 * HOUR_HEIGHT` (`336`) regardless of `isToday`, so the first new test's
`388` assertion fails.

- [ ] **Step 3: Write the implementation**

In `frontend/src/features/tasks/components/day-timeline.tsx`, change the
constants block (currently lines 13-15):

```ts
export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const VIEWPORT_HOURS = 12; // hours visible in the rail's scroll viewport at once
const VIEWPORT_HEIGHT = VIEWPORT_HOURS * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // fallback start for non-today dates
```

Replace the scroll-effect (currently lines 32-36):

```ts
  useEffect(() => {
    const railEl = railRef.current;
    if (!railEl) return;
    if (isToday) {
      const target = toOffset(nowTime()) - VIEWPORT_HEIGHT / 2;
      railEl.scrollTop = Math.min(Math.max(target, 0), RAIL_HEIGHT - VIEWPORT_HEIGHT);
    } else {
      railEl.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date, isToday]);
```

Replace the rail element's className/style (currently
`className="relative max-h-96 min-h-48 overflow-y-auto rounded-md border border-border/60"`
with no `style` prop):

```tsx
      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative overflow-y-auto rounded-md border border-border/60"
        style={{ height: VIEWPORT_HEIGHT }}
      >
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (all tests in the file — the pre-existing "splits all-day and
timed tasks" and drag-to-schedule tests are unaffected since they mock
`getBoundingClientRect` directly rather than depending on the CSS height).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: widen Time Table to a 12h viewport, center scroll on now"
```

---

### Task 5: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run (from `frontend/`): `npm test`
Expected: PASS, all files (including Tasks 1-4's changes and the untouched
drag-to-schedule suite).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no errors (in particular, no unused-import warnings for
`windowAround`, `weekdayOf`, or `DAY_LABELS` in `daily-view.tsx`).

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS — confirms no type errors from `DailyView`'s narrowed prop
destructuring or the removed `lib/dates.ts` exports.

- [ ] **Step 4: Manual browser verification checklist**

Start the dev server (`npm run dev`) and, on `/app`'s Daily tab:

1. Confirm the toolbar's Prev/Next arrows move exactly one day per click (not
   a week).
2. Confirm there are no neighboring-day peek cells — only the Day column and
   the Weekly column, roughly equal width.
3. On today, confirm the Time Table opens already scrolled so the current-time
   line is roughly centered in view, with about 12 hours visible without
   scrolling.
4. On a past or future date, confirm the Time Table opens scrolled to 07:00.
5. Repeat the original bug report: drag an all-day task down onto the rail
   (or a rail chip to a new time), ending the drag gesture near the Weekly
   column on the right. Confirm the focused day does **not** change and the
   task's time updates correctly.
6. Confirm dragging still works for all three paths (all-day→rail,
   rail→rail, rail→all-day) exactly as before this change.

- [ ] **Step 5: Report status**

If all checks pass, the branch is ready to push. If any manual check fails,
stop and report which one before proceeding — do not attempt an ad hoc fix
outside this plan's task boundaries.
