# Landing Page Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's generic hero and fake product mockup with a dark-first, product-led split layout showing a faithful, static preview of the real Daily view.

**Architecture:** Two self-contained changes: (1) rewrite `TaskMock` from a fabricated "Today/Inbox/Done" mockup into a static, presentational preview that visually mirrors `DayTimeline`/`DayAgenda`'s real classes and labels; (2) rebuild `page.tsx`'s hero `<section>` from a centered stack into a two-column split (copy left, `TaskMock` right) with new headline/subhead copy. No new components, no new dependencies, no changes to routing, auth, or the real `/app` Daily view.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4 (semantic tokens from `globals.css`), Vitest + Testing Library.

## Global Constraints

- Use only semantic Tailwind token classes already defined in `globals.css` (`bg-card`, `bg-background`, `text-foreground`, `text-muted-foreground`, `text-subtle`, `text-brand`, `border-border`, `border-l-brand`, `bg-brand/10`, etc.) — never literal hex colors, matching `.superdesign/design-system.md`'s Color section.
- `TaskMock` stays a static, presentational, `aria-hidden` component with **zero props** — it does not import `DailyView`, `DayTimeline`, `DayAgenda`, `useTasks`, or any store/provider. It approximates their visual language (colors, spacing, radius, exact label text) by hand, not by reuse.
- The right-side agenda section labels must read exactly `All Day To-Do` and `Next Up` (verbatim, matching `DayAgenda`).
- Keep the existing CTA behavior, labels, and hrefs exactly as they are today: logged-in → "Open app" (`/app`); logged-out → "Get started" (`/signup`) + "Sign in" (`/login`). The design brief left the "Get started" vs. "Start planning" label as an open copy choice; this plan keeps the current, already-implemented labels to avoid unrelated churn — do not rename them.
- Do not add a "Features" or "How it works" nav item, and do not add any "View demo" CTA.
- Do not touch `SiteHeader`, `SiteFooter`, auth routes, or middleware.
- No new npm dependencies.
- No automated test targets `app/page.tsx` directly (see Task 2 rationale) — verify that task with the dev server in a browser instead, in both light and dark theme.

---

### Task 1: Rewrite `TaskMock` as a faithful Daily-view preview

**Files:**
- Modify: `frontend/src/components/task-mock.tsx`
- Test: `frontend/src/components/task-mock.test.tsx` (new)

**Interfaces:**
- Consumes: nothing (no props, no external state).
- Produces: `export function TaskMock(): JSX.Element` — same export shape as today, so Task 2 can import it unchanged. Rendered root is a single `aria-hidden` block-level element (a full card, not the old top-flush partial card) sized to fill its parent's width via `w-full` (no fixed pixel width) so Task 2 can drop it into a flex column.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/task-mock.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskMock } from "./task-mock";

describe("TaskMock", () => {
  it("renders the real Daily view section labels", () => {
    render(<TaskMock />);
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.getByText("Next Up")).toBeTruthy();
  });

  it("shows realistic task titles and time ranges, not unlabeled bars", () => {
    render(<TaskMock />);
    expect(screen.getByText("Design review reply")).toBeTruthy();
    expect(screen.getByText("9:30 – 10:15")).toBeTruthy();
  });

  it("no longer shows the old fabricated nav", () => {
    render(<TaskMock />);
    expect(screen.queryByText("Inbox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/task-mock.test.tsx`
Expected: FAIL — current `TaskMock` renders "Today"/"Inbox"/"Done" and task rows like "Book dentist appointment", not "All Day To-Do"/"Next Up"/"Design review reply"/"9:30 – 10:15".

- [ ] **Step 3: Replace `task-mock.tsx`'s implementation**

Replace the full contents of `frontend/src/components/task-mock.tsx` with:

```tsx
import { cn } from "@/lib/utils";

const timelineBlocks: { time: string; title: string; accent: "brand" | "muted" }[] = [
  { time: "9:30 – 10:15", title: "Design review reply", accent: "brand" },
  { time: "1:00 – 1:45", title: "Book dentist appointment", accent: "muted" },
  { time: "2:30 – 3:00", title: "Standup notes", accent: "muted" },
];

export function TaskMock() {
  return (
    <div
      aria-hidden
      className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">
          Tuesday, March 10
        </h2>
      </div>
      <div className="flex">
        <div className="flex-[3] space-y-3 border-r border-border p-4">
          {timelineBlocks.map((block) => (
            <div
              key={block.title}
              className={cn(
                "rounded-r-md border-l-2 px-2.5 py-1.5",
                block.accent === "brand"
                  ? "border-l-brand bg-brand/10"
                  : "border-l-muted-foreground bg-muted/40",
              )}
            >
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {block.time}
              </span>
              <span className="text-[11px] font-medium text-foreground">{block.title}</span>
            </div>
          ))}
        </div>
        <div className="flex-[2] p-4">
          <section>
            <h3 className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
              All Day To-Do
            </h3>
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="size-3.5 shrink-0 rounded-[4px] border-2 border-border" />
              <span className="truncate text-[11px] text-foreground">Grocery pickup</span>
            </div>
          </section>
          <section className="mt-4">
            <h3 className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
              Next Up
            </h3>
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="size-3.5 shrink-0 rounded-[4px] border-2 border-brand" />
              <span className="truncate text-[11px] text-foreground">Finalize API notes</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/task-mock.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/task-mock.tsx frontend/src/components/task-mock.test.tsx
git commit -m "feat: rebuild landing page task mock as a faithful Daily view preview"
```

---

### Task 2: Rebuild the landing page hero into a product-led split layout

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `TaskMock` from Task 1 (`@/components/task-mock`), unchanged import path, zero props.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

**No automated test for this task.** `page.tsx` is an async server component with no existing test file and no established pattern elsewhere in this codebase for testing server components (`app/app/page.tsx` has none either) — adding one here would mean inventing new test infrastructure (mocking `getCurrentUserOrNull`, Next.js server-component rendering) not otherwise justified by this task's scope. Verify manually instead, per Step 2 below.

- [ ] **Step 1: Replace the hero section in `frontend/src/app/page.tsx`**

Replace lines 17-59 (the `<main>` block, from `<main className="flex flex-1 flex-col">` through the closing `</main>`) with:

```tsx
      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 pt-[10vh] pb-16 lg:flex-row lg:items-center lg:pt-[14vh]">
          <div className="flex flex-col items-center text-center lg:flex-1 lg:items-start lg:text-left">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Pick up your day.
            </h1>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Plan what matters today, and see your whole week at a glance.
            </p>
            <div className="mt-8 flex gap-3">
              {user ? (
                <Link
                  href="/app"
                  className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}
                >
                  Open app
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}
                  >
                    Get started
                  </Link>
                  <Link
                    href="/login"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "rounded-full px-6",
                    )}
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="w-full lg:flex-[1.1]">
            <TaskMock />
          </div>
        </section>
      </main>
```

This removes the old second `<section>` that held `TaskMock` below the fold — it now lives inside the hero's right column. The CTA branch logic is unchanged (same conditions, hrefs, labels, and button classes as before), only its surrounding markup moved.

- [ ] **Step 2: Verify manually with the dev server**

Run: `cd frontend && npm run dev`

In a browser at `http://localhost:3000`:
- Confirm the hero shows "Pick up your day." on the left and the `TaskMock` preview on the right at desktop width (≥ `lg` breakpoint, 1024px), and stacks (text above preview) below it.
- Confirm the preview shows "All Day To-Do", "Next Up", and the three timeline task titles/times — no unlabeled colored bars.
- Toggle the theme switcher (in `SiteHeader`) and confirm both the hero and the preview card render correctly in light mode as well as dark mode (no hardcoded-dark elements going illegible).
- Confirm there is exactly one primary CTA plus "Sign in" when logged out, and only "Open app" when logged in — no "View demo", no "Features"/"How it works" nav.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all existing tests still pass (this task changes no exported interfaces other tests depend on).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: rebuild landing page hero as a product-led split layout"
```
