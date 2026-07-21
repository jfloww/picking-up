# All-day Zone Above the Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Daily tab's All-day zone above the hour rail (reversing the prior below-the-rail order), while keeping the rail's shrink-to-a-6h-floor behavior unchanged — only visual/DOM position swaps.

**Architecture:** Add an optional `secondaryFirst` boolean prop to the existing `ShrinkStack` component that swaps actual JSX/DOM render order (not CSS `order`, to keep tab/reading order matching the screen). `DayTimeline` passes it so the All-day zone renders first.

**Tech Stack:** Next.js/React (TypeScript), Tailwind CSS, Vitest + `@testing-library/react`.

## Global Constraints

- No new npm dependencies.
- `secondaryFirst` must default to `false` so `ShrinkStack`'s current behavior is unchanged for any call that doesn't pass it (per spec: `docs/superpowers/specs/2026-07-21-all-day-zone-above-rail-design.md`).
- Frontend tests run via `npm test` (`vitest run`) from `frontend/`; a single file can be targeted with `npx vitest run <path>`.
- Reorder DOM order, not CSS `order` — tab/reading order must match visual order.

---

### Task 1: `secondaryFirst` prop on `ShrinkStack`, wired into `DayTimeline`

**Files:**
- Modify: `frontend/src/components/shrink-stack.tsx:9-45`
- Modify: `frontend/src/components/shrink-stack.test.tsx`
- Modify: `frontend/src/features/tasks/components/day-timeline.tsx:57-145`
- Modify: `frontend/src/features/tasks/components/day-timeline.test.tsx:73-81`

**Interfaces:**
- Produces: `ShrinkStack` gains prop `secondaryFirst?: boolean` (default `false`). All other props (`primary`, `primaryMinHeight`, `primaryMaxHeight`, `secondary`, `gap`) and both `data-testid`s are unchanged in meaning.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shrink-stack.test.tsx`, add this test inside the existing `describe("ShrinkStack", ...)` block (after the last test, i.e. after line 60):

```tsx
  it("renders secondary before primary when secondaryFirst is set", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
        secondaryFirst
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(
      secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps primary before secondary when secondaryFirst is not set", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(
      primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
```

In `frontend/src/features/tasks/components/day-timeline.test.tsx`, replace the existing test at lines 73-81 (`"renders the hour rail before the All-day section"`) with:

```tsx
  it("renders the All-day section before the hour rail", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    const rail = screen.getByTestId("hour-rail");
    const allDay = screen.getByTestId("all-day-zone");
    expect(
      allDay.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`):
```
npx vitest run src/components/shrink-stack.test.tsx src/features/tasks/components/day-timeline.test.tsx
```
Expected: the two new `shrink-stack.test.tsx` tests FAIL — `secondaryFirst` isn't a recognized prop yet, so `secondaryFirst` renders as an unhandled attribute and DOM order stays primary-then-secondary regardless, so the "renders secondary before primary" assertion fails. The updated `day-timeline.test.tsx` test FAILS because the rail still renders before the All-day zone.

- [ ] **Step 3: Add `secondaryFirst` to `ShrinkStack`**

In `frontend/src/components/shrink-stack.tsx`, replace lines 9-45 with:

```tsx
type ShrinkStackProps = {
  primary: ReactNode;
  primaryMinHeight: number;
  primaryMaxHeight: number;
  secondary: ReactNode;
  gap?: number;
  secondaryFirst?: boolean;
};

export function ShrinkStack({
  primary,
  primaryMinHeight,
  primaryMaxHeight,
  secondary,
  gap = 6,
  secondaryFirst = false,
}: ShrinkStackProps) {
  const primaryPane = (
    <div
      data-testid="shrink-stack-primary"
      className="flex-1 overflow-hidden"
      style={{ minHeight: primaryMinHeight, maxHeight: primaryMaxHeight }}
    >
      {primary}
    </div>
  );
  const secondaryPane = (
    <div
      data-testid="shrink-stack-secondary"
      className="shrink-0 overflow-hidden"
      style={{ maxHeight: `calc(100% - ${primaryMinHeight}px - ${gap}px)` }}
    >
      {secondary}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ gap }}>
      {/* The explicit minHeight is what creates the floor. overflow-hidden
          clips primary content that doesn't self-scroll (the Daily rail
          happens to, but a future caller's content might not). */}
      {secondaryFirst ? (
        <>
          {secondaryPane}
          {primaryPane}
        </>
      ) : (
        <>
          {primaryPane}
          {secondaryPane}
        </>
      )}
    </div>
  );
}
```

Keep the existing `type ReactNode` import and the JSDoc comment above `ShrinkStackProps` (lines 3-8) unchanged.

- [ ] **Step 4: Pass `secondaryFirst` from `DayTimeline`**

In `frontend/src/features/tasks/components/day-timeline.tsx`, add `secondaryFirst` to the `<ShrinkStack>` call. Change:

```tsx
        primaryMinHeight={VIEWPORT_HEIGHT / 2}
        primaryMaxHeight={VIEWPORT_HEIGHT}
        secondary={
```

(currently lines 117-119) to:

```tsx
        primaryMinHeight={VIEWPORT_HEIGHT / 2}
        primaryMaxHeight={VIEWPORT_HEIGHT}
        secondaryFirst
        secondary={
```

No other changes to this file.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```
npx vitest run src/components/shrink-stack.test.tsx src/features/tasks/components/day-timeline.test.tsx
```
Expected: PASS (all tests in both files).

- [ ] **Step 6: Run the full frontend test suite**

Run (from `frontend/`): `npm test`
Expected: PASS — no other file references `ShrinkStack`'s prop order or the rail/All-day document order.

- [ ] **Step 7: Manual browser verification**

Start the dev server (`npm run dev` from `frontend/`), open the Daily tab, and confirm the All-day zone (with the quick-add input) now renders above the hour rail, and that adding All-day tasks still shrinks the rail toward its 6h floor exactly as before — only the stacking order changed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/shrink-stack.tsx frontend/src/components/shrink-stack.test.tsx frontend/src/features/tasks/components/day-timeline.tsx frontend/src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: render the All-day zone above the hour rail"
```
