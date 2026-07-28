# Landing Page: Premium Minimal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the side-by-side hero shipped in PR #34 with a stacked layout where a large, full-width product preview is the primary visual anchor, add a structured three-benefit section below it, and add a restrained entrance animation plus a looping product-completion demo — all with pure CSS, no new dependencies.

**Architecture:** Two tasks. Task 1 adds the shared CSS animation infrastructure (keyframes + Tailwind `@theme` tokens + a reduced-motion guard) to `globals.css` and rewrites `TaskMock` to use it for the demo-completion loop, at a larger internal scale befitting its new full-width footprint. Task 2 rebuilds `page.tsx`'s hero into the stacked layout, applies the entrance-animation classes, and adds the new benefits section and trust line.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4 (CSS custom properties + `@theme inline` tokens in `globals.css`), Vitest + Testing Library.

## Global Constraints

- Headline renders at `text-5xl sm:text-6xl` (48px → 60px, within the spec's "roughly 56-64px" target at the `sm` breakpoint and up) — not the ultra-light or aggressively-bold treatments explicitly rejected in the spec.
- Content container is `max-w-[1200px]` (within the spec's 1120–1280px range) for the hero and benefits section.
- Brand blue (`text-brand`/`border-brand`/`border-l-brand`/`bg-brand/10`) is used only for the one "active" timeline block, the "Next Up" checkbox outlines, and the demo animation's completed state — never as a broad decorative accent.
- No gradients, no decorative imagery/illustrations, no glassmorphism/blur effects, no scroll-jacking, no fake cursor animation, no scroll-triggered reveals.
- No new npm dependencies. The demo-completion loop and entrance animation are pure CSS (`@keyframes` + Tailwind arbitrary-property classes) — `TaskMock` stays a plain, non-`"use client"`, server-renderable function component; no `useState`/`useEffect`/timers.
- Exact copy (verbatim, do not paraphrase):
  - Headline: "Pick up your day."
  - Subhead: "Turn your to-dos into a clear plan — one day at a time, one week in view."
  - Benefit 1 title: "Focus your day" — description: "Turn tasks into a clear timeline and actionable agenda."
  - Benefit 2 title: "See your week clearly" — description: "Understand your workload across the week at a glance."
  - Benefit 3 title: "Keep routines flexible" — description: "Repeat what matters and adjust one occurrence without breaking the whole series."
  - Trust line: "Your tasks stay synced across devices."
- CTA behavior is unchanged from PR #34: logged-in → "Open app" (`/app`); logged-out → "Get started" (`/signup`) + "Sign in" (`/login`). Only its position changes (centered, under the subhead).
- `TaskMock`'s section labels stay exactly `All Day To-Do` and `Next Up`, matching the real `DayAgenda` component — unchanged from PR #34.
- No changes to `SiteHeader`, `SiteFooter`, auth routes, middleware, or the real `/app` Daily view.
- No automated test targets `app/page.tsx` directly — same rationale as PR #34 (no server-component test precedent in this codebase). Verify that task with the dev server in a browser instead, in both light and dark theme, if a working dev server is available in your environment.

---

### Task 1: Add animation infrastructure to `globals.css` and rebuild `TaskMock` at premium scale

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/task-mock.tsx`
- Modify: `frontend/src/components/task-mock.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: three Tailwind utility classes consumable by Task 2 — `animate-fade-up` (one-shot entrance fade, `both` fill-mode, no `infinite`) and the arbitrary-property pattern `[animation-delay:<N>ms]` for staggering it (not a custom class, just documenting that Task 2 will pair `animate-fade-up` with an explicit `[animation-delay:...]` on each staggered element). `TaskMock` keeps its existing `export function TaskMock(): JSX.Element` signature, zero props, so Task 2's `<TaskMock />` usage is unchanged.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `frontend/src/components/task-mock.test.tsx` with:

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

  it("is aria-hidden, since it is decorative", () => {
    const { container } = render(<TaskMock />);
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
    expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("includes a demo task wired to the CSS completion-loop animation classes", () => {
    render(<TaskMock />);
    const title = screen.getByText("Prep client agenda");
    expect(title.className).toContain("animate-hero-demo-title");
    const row = title.closest("div");
    expect(row?.className).toContain("animate-hero-demo-row");
    const dot = row?.querySelector("span:first-child");
    expect(dot?.className).toContain("animate-hero-demo-dot");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/task-mock.test.tsx`
Expected: FAIL on the new 5th test — `Prep client agenda` doesn't exist yet in the current `TaskMock`.

- [ ] **Step 3: Add animation keyframes and tokens to `globals.css`**

In `frontend/src/app/globals.css`, inside the existing `@theme inline { ... }` block, add these four lines directly after the existing `--animate-task-complete: task-complete-pop 220ms ease-out;` line (do not remove or reorder any existing line):

```css
  --animate-task-complete: task-complete-pop 220ms ease-out;
  --animate-fade-up: fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
  --animate-hero-demo-row: hero-demo-row 7s ease infinite;
  --animate-hero-demo-dot: hero-demo-dot 7s ease infinite;
  --animate-hero-demo-title: hero-demo-title 7s ease infinite;
```

Then, after the existing `@keyframes task-complete-pop { ... }` block at the bottom of the file, append:

```css
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes hero-demo-row {
  0%,
  55%,
  100% {
    background-color: var(--muted);
  }
  70%,
  92% {
    background-color: var(--card);
  }
}

@keyframes hero-demo-dot {
  0%,
  55%,
  100% {
    background-color: transparent;
    border-color: var(--brand);
  }
  70%,
  92% {
    background-color: var(--brand);
    border-color: var(--brand);
  }
}

@keyframes hero-demo-title {
  0%,
  55%,
  100% {
    color: var(--foreground);
    text-decoration-line: none;
  }
  70%,
  92% {
    color: var(--muted-foreground);
    text-decoration-line: line-through;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-up,
  .animate-hero-demo-row,
  .animate-hero-demo-dot,
  .animate-hero-demo-title {
    animation: none;
  }
}
```

- [ ] **Step 4: Replace `task-mock.tsx`'s implementation**

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
      className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
    >
      <div className="border-b border-border px-8 py-6">
        <p className="text-xl font-bold tracking-tight text-foreground">Tuesday, March 10</p>
      </div>
      <div className="flex">
        <div className="flex-[3] space-y-4 border-r border-border p-8">
          {timelineBlocks.map((block) => (
            <div
              key={block.title}
              className={cn(
                "rounded-r-lg border-l-2 px-4 py-3",
                block.accent === "brand"
                  ? "border-l-brand bg-brand/10"
                  : "border-l-muted-foreground bg-muted/40",
              )}
            >
              <span className="block text-xs tabular-nums text-muted-foreground">
                {block.time}
              </span>
              <span className="text-sm font-medium text-foreground">{block.title}</span>
            </div>
          ))}
        </div>
        <div className="flex-[2] p-8">
          <section>
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              All Day To-Do
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-border" />
              <span className="truncate text-sm text-foreground">Grocery pickup</span>
            </div>
          </section>
          <section className="mt-6">
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              Next Up
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="truncate text-sm text-foreground">Finalize API notes</span>
            </div>
            <div className="animate-hero-demo-row mt-2 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="animate-hero-demo-dot size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="animate-hero-demo-title truncate text-sm text-foreground">
                Prep client agenda
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/task-mock.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/components/task-mock.tsx frontend/src/components/task-mock.test.tsx
git commit -m "feat: add premium-scale TaskMock preview with a CSS-only completion-loop demo"
```

---

### Task 2: Rebuild the landing page hero into a stacked layout with a benefits section

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `TaskMock` from Task 1 (`@/components/task-mock`), unchanged import path, zero props. Consumes the `animate-fade-up` utility class from Task 1's `globals.css` changes, paired with `[animation-delay:<N>ms]` arbitrary-property classes for staggering.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

**No automated test for this task.** Same rationale as PR #34: `page.tsx` is an async server component with no existing test file and no established pattern elsewhere in this codebase for testing server components. Verify manually instead, per Step 2 below.

- [ ] **Step 1: Replace the hero section in `frontend/src/app/page.tsx`**

Replace lines 17-59 (the `<main>` block, from `<main className="flex flex-1 flex-col">` through the closing `</main>`) with:

```tsx
      <main className="flex flex-1 flex-col">
        <section className="mx-auto w-full max-w-[1200px] px-6 pb-24 pt-[10vh] lg:pt-[14vh]">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h1 className="animate-fade-up text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Pick up your day.
            </h1>
            <p className="animate-fade-up mt-5 max-w-md text-base text-muted-foreground [animation-delay:120ms] sm:text-lg">
              Turn your to-dos into a clear plan — one day at a time, one week in view.
            </p>
            <div className="animate-fade-up mt-8 flex gap-3 [animation-delay:240ms]">
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

          <div className="animate-fade-up mt-16 [animation-delay:400ms]">
            <TaskMock />
          </div>

          <div className="mt-24 flex flex-col gap-10 border-t border-border pt-12 sm:flex-row sm:gap-0">
            <div className="flex-1 sm:pr-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Focus your day
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Turn tasks into a clear timeline and actionable agenda.
              </p>
            </div>
            <div className="flex-1 sm:border-l sm:border-border sm:px-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                See your week clearly
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Understand your workload across the week at a glance.
              </p>
            </div>
            <div className="flex-1 sm:border-l sm:border-border sm:pl-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Keep routines flexible
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Repeat what matters and adjust one occurrence without breaking the whole series.
              </p>
            </div>
          </div>

          <p className="mt-10 text-center text-xs text-subtle">
            Your tasks stay synced across devices.
          </p>
        </section>
      </main>
```

This replaces PR #34's `lg:flex-row` side-by-side split with a stacked layout: centered headline/subhead/CTA, then the full-width `TaskMock` preview below, then the new three-column benefits section (divided by `sm:border-l`, not cards), then the trust line. The CTA branch logic (conditions, hrefs, labels, button classes) is unchanged from before, only relocated and given entrance-animation classes.

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit` — confirm no type errors.

If a working dev server is available in your environment (`cd frontend && npm run dev`), open `http://localhost:<port>/` in a browser and confirm:
- The headline, subhead, and CTA row fade up in a quick staggered sequence on load, followed by the preview.
- The preview's "Prep client agenda" row cycles through a completion state (checkbox fills, title strikes through, holds briefly, resets) on a slow (~7s) loop.
- The three benefit columns render with the exact copy above, divided by thin vertical borders on desktop widths, stacked on narrow widths.
- The trust line reads "Your tasks stay synced across devices." below the benefits.
- Both light and dark theme (toggle via `SiteHeader`'s theme switcher) render legibly — no invisible-on-light-background elements.
- Setting the OS/browser "reduce motion" preference disables both the entrance fade and the demo loop (elements appear immediately, `TaskMock` renders in its steady, uncompleted state).

If no dev server can be reliably run in your environment (this has been unreliable in sandboxed environments before), note that in your report instead of fabricating results — do not claim a check you couldn't actually perform.

Stop the dev server (Ctrl+C) once confirmed, if it was started.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all existing tests still pass, including Task 1's updated `task-mock.test.tsx` (this task changes no exported interfaces other tests depend on).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: rebuild landing page hero as a stacked layout with a benefits section"
```
