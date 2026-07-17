# Shared Site Header & Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the landing page (`/`) and the app workspace (`/app`) a shared header (wordmark → `/`, theme toggle, Sign in / user name + Sign out) and footer (wordmark, copyright, GitHub link), with the landing page's hero adapting when the visitor is already logged in.

**Architecture:** Two new presentational components (`SiteHeader`, `SiteFooter`) under `frontend/src/components/`, a new `getCurrentUserOrNull()` server helper in the auth feature that both pages call once and pass down, and a small middleware change so the landing page also gets transparent access-token refresh. Spec: `docs/superpowers/specs/2026-07-17-site-header-footer-design.md`.

**Tech Stack:** Next.js 15 (App Router, Server Components), React 19, TypeScript, Tailwind 4 tokens, Vitest + Testing Library (jsdom, globals disabled, colocated `*.test.ts(x)`).

## Global Constraints

- Work on branch `feat/site-chrome` (create from `main` before Task 1).
- All commands run inside `frontend/`.
- Applies to `/` and `/app` only — `/login`/`/signup` keep their current header (Wordmark + `ThemeToggle`, no footer), per the approved spec.
- No legacy/invented CSS classes — Tailwind utilities with existing design tokens only (`bg-background`, `text-muted-foreground`, `border-border`, …), matching the exact classes already used on the landing page's current header/footer.
- Interactive components need `"use client"`; Server Components (the two `page.tsx` files) stay plain `async` functions — no `"use client"` on them.
- `lucide-react@1.24.0` (installed version) has no `Github` icon export — the footer's GitHub link is a plain text link, not an icon (confirmed by inspecting `node_modules/lucide-react/dist/esm/icons/`; do not attempt to import a `Github` icon).
- Tests must not depend on real network/cookies: `getCurrentUserOrNull` takes an injectable `fetchUser` parameter (defaulting to the real `requestCurrentUser`) so it's testable without mocking `next/headers`; `SiteHeader`'s test must mock `next/navigation`'s `useRouter` (required transitively by `LogoutButton`, which throws outside a router context).
- Commit style: conventional commits, each message ending with the line:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 1: `getCurrentUserOrNull()` helper + route refactor

**Files:**
- Modify: `frontend/src/features/auth/api/auth.ts`
- Modify: `frontend/src/app/api/auth/me/route.ts`
- Test: `frontend/src/features/auth/api/auth.test.ts`

**Interfaces:**
- Consumes: `CurrentUser` from `../types`; existing `requestCurrentUser(): Promise<CurrentUser>`.
- Produces: `getCurrentUserOrNull(fetchUser?: () => Promise<CurrentUser>): Promise<CurrentUser | null>` — resolves to the user on success, `null` on any thrown error. Default `fetchUser` is `requestCurrentUser`, so real callers use `getCurrentUserOrNull()` with no arguments.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/auth/api/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "../types";
import { getCurrentUserOrNull } from "./auth";

const user: CurrentUser = { id: 1, email: "jane@example.com" };

describe("getCurrentUserOrNull", () => {
  it("returns the user when the fetch succeeds", async () => {
    const fetchUser = vi.fn().mockResolvedValue(user);
    expect(await getCurrentUserOrNull(fetchUser)).toEqual(user);
  });

  it("returns null when the fetch throws", async () => {
    const fetchUser = vi.fn().mockRejectedValue(new Error("Unauthorized."));
    expect(await getCurrentUserOrNull(fetchUser)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/auth/api/auth.test.ts`
Expected: FAIL — `getCurrentUserOrNull` is not exported from `./auth`.

- [ ] **Step 3: Implement `getCurrentUserOrNull`**

Append to `frontend/src/features/auth/api/auth.ts` (after the existing `requestCurrentUser` function; no other changes to this file):

```ts
export async function getCurrentUserOrNull(
  fetchUser: () => Promise<CurrentUser> = requestCurrentUser,
): Promise<CurrentUser | null> {
  try {
    return await fetchUser();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/auth/api/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor the `/api/auth/me` route to use the new helper**

Replace the full contents of `frontend/src/app/api/auth/me/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCurrentUserOrNull } from "@/features/auth/api/auth";

export async function GET() {
  const user = await getCurrentUserOrNull();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ user });
}
```

This is a behavior-preserving refactor (still 401 + `{ error }` on failure) — there is no test for this route file (no established pattern for testing Next.js route handlers in this repo); it's covered by the manual verification in Task 6.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test` — expect all green (no regressions, 2 new tests).

```bash
git add src/features/auth/api/auth.ts src/features/auth/api/auth.test.ts src/app/api/auth/me/route.ts
git commit -m "feat: add getCurrentUserOrNull auth helper"
```

---

### Task 2: `SiteHeader` component

**Files:**
- Create: `frontend/src/components/site-header.tsx`
- Test: `frontend/src/components/site-header.test.tsx`

**Interfaces:**
- Consumes: `CurrentUser` from `@/features/auth/types`; `Wordmark` from `@/components/wordmark`; `ThemeToggle` from `@/components/theme-toggle`; `LogoutButton` from `@/features/auth/components/logout-button`; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- Produces: `displayName(user: CurrentUser): string` (exported, pure); `SiteHeader({ user: CurrentUser | null }): JSX.Element` (default export is NOT used — use a named export, matching every other component in this codebase).

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/site-header.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { ThemeProvider } from "@/components/theme-provider";
import type { CurrentUser } from "@/features/auth/types";

import { displayName, SiteHeader } from "./site-header";

function renderHeader(user: CurrentUser | null) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SiteHeader user={user} />
    </ThemeProvider>,
  );
}

describe("displayName", () => {
  it("prefers the full name when present", () => {
    expect(
      displayName({
        id: 1,
        email: "j@example.com",
        first_name: "Jane",
        last_name: "Doe",
      }),
    ).toBe("Jane Doe");
  });

  it("falls back to username when no name is set", () => {
    expect(
      displayName({ id: 1, email: "j@example.com", username: "janedoe" }),
    ).toBe("janedoe");
  });

  it("falls back to email when neither name nor username is set", () => {
    expect(displayName({ id: 1, email: "j@example.com" })).toBe(
      "j@example.com",
    );
  });
});

describe("SiteHeader", () => {
  it("shows a Sign in link when logged out", () => {
    renderHeader(null);
    expect(
      screen.getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Sign out")).toBeNull();
  });

  it("shows the display name and a Sign out button when logged in", () => {
    renderHeader({ id: 1, email: "jane@example.com", first_name: "Jane" });
    expect(screen.getByText("Jane")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("always renders the wordmark linking to /", () => {
    renderHeader(null);
    expect(
      screen.getByRole("link", { name: /picking up/i }),
    ).toHaveAttribute("href", "/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/site-header.test.tsx`
Expected: FAIL — cannot resolve `./site-header`.

- [ ] **Step 3: Implement `site-header.tsx`**

```tsx
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { LogoutButton } from "@/features/auth/components/logout-button";
import type { CurrentUser } from "@/features/auth/types";
import { cn } from "@/lib/utils";

export function displayName(user: CurrentUser): string {
  const full = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || user.username || user.email;
}

export function SiteHeader({ user }: { user: CurrentUser | null }) {
  return (
    <header className="flex items-center justify-between px-6 py-5 sm:px-10">
      <Wordmark />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {user ? (
          <>
            <span className="text-sm text-muted-foreground">
              {displayName(user)}
            </span>
            <LogoutButton />
          </>
        ) : (
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "rounded-full px-4",
            )}
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/site-header.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expect all green.

```bash
git add src/components/site-header.tsx src/components/site-header.test.tsx
git commit -m "feat: add SiteHeader component"
```

---

### Task 3: `SiteFooter` component

**Files:**
- Create: `frontend/src/components/site-footer.tsx`
- Test: `frontend/src/components/site-footer.test.tsx`

**Interfaces:**
- Consumes: `Wordmark` from `@/components/wordmark`; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- Produces: `SiteFooter(): JSX.Element` (named export, no props).

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/site-footer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("shows the copyright text and the wordmark linking to /", () => {
    render(<SiteFooter />);
    expect(screen.getByText("© 2026 Picking Up")).toBeTruthy();
    // Wordmark renders "PICKING" and "UP" joined by &nbsp; (U+00A0), which a
    // plain space in a regex won't match — \s+ does.
    const wordmarkLink = screen.getByRole("link", { name: /picking\s+up/i });
    expect(wordmarkLink.getAttribute("href")).toBe("/");
  });

  it("links to the GitHub profile, opening in a new tab", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: "GitHub profile" });
    expect(link.getAttribute("href")).toBe("https://github.com/jfloww");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/site-footer.test.tsx`
Expected: FAIL — cannot resolve `./site-footer`.

- [ ] **Step 3: Implement `site-footer.tsx`**

```tsx
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export function SiteFooter() {
  return (
    <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
      <Wordmark className="opacity-60" />
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">© 2026 Picking Up</p>
        <a
          href="https://github.com/jfloww"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub profile"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "rounded-full",
          )}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/site-footer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expect all green.

```bash
git add src/components/site-footer.tsx src/components/site-footer.test.tsx
git commit -m "feat: add SiteFooter component"
```

---

### Task 4: Middleware — silent refresh on the landing page

**Files:**
- Modify: `frontend/src/middleware.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `isAccessTokenValid`, `refreshTokens`, `setAuthCookies` already in this file.
- Produces: no new exports; behavior change only (see below).

- [ ] **Step 1: Add the `refreshOnlyRoutes` list**

In `frontend/src/middleware.ts`, find:

```ts
const protectedRoutes = ["/app"];
const authRoutes = ["/login", "/signup"];
```

Replace with:

```ts
const protectedRoutes = ["/app"];
const authRoutes = ["/login", "/signup"];
// Not protected and not an auth form — but still needs a fresh access
// token so the header can show the correct signed-in state. Never redirects.
const refreshOnlyRoutes = ["/"];
```

- [ ] **Step 2: Include it in the early-return check**

Find:

```ts
  const { pathname } = request.nextUrl;
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));
  const isAuthRoute = authRoutes.includes(pathname);

  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }
```

Replace with:

```ts
  const { pathname } = request.nextUrl;
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));
  const isAuthRoute = authRoutes.includes(pathname);
  const isRefreshOnlyRoute = refreshOnlyRoutes.includes(pathname);

  if (!isProtectedRoute && !isAuthRoute && !isRefreshOnlyRoute) {
    return NextResponse.next();
  }
```

No other changes to this file are needed: the existing redirect blocks are already gated on `isProtectedRoute` and `isAuthRoute` specifically (not on "any route that reached this point"), so a request to `/` falls through both redirect blocks untouched and reaches the existing tail — `if (refreshedTokens) { …set cookies… }` else `return NextResponse.next();` — which is exactly "refresh silently, never redirect."

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test` — expect all green (no regressions; this file has no dedicated tests — see Task 6 for manual verification).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: refresh access token silently on the landing page"
```

---

### Task 5: Landing page integration

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `SiteHeader` (Task 2), `SiteFooter` (Task 3), `getCurrentUserOrNull` (Task 1).
- Produces: no new exports — `HomePage` becomes an `async` Server Component.

- [ ] **Step 1: Replace the full contents of `frontend/src/app/page.tsx`**

```tsx
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TaskMock } from "@/components/task-mock";
import { getCurrentUserOrNull } from "@/features/auth/api/auth";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const user = await getCurrentUserOrNull();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader user={user} />

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-[12vh] text-center">
          <h1 className="text-4xl font-extralight tracking-tight text-foreground sm:text-6xl">
            Everything you need to do.
            <br />
            Nothing else.
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            The calm home for your tasks.
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
        </section>

        <section className="mx-auto mt-14 w-full max-w-4xl px-6">
          <TaskMock />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
```

No unit test for this file (Server Component with data fetching — no established pattern in this repo for mocking Next.js request context; covered by manual verification in Task 6).

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test` — expect all green.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: wire SiteHeader/SiteFooter into the landing page"
```

---

### Task 6: App workspace integration + full verification

**Files:**
- Modify: `frontend/src/app/app/page.tsx`

**Interfaces:**
- Consumes: `SiteHeader` (Task 2), `SiteFooter` (Task 3), `getCurrentUserOrNull` (Task 1), existing `TaskCalendar` from `@/features/tasks/components/task-calendar`.
- Produces: no new exports — `AppPage` becomes an `async` Server Component.

- [ ] **Step 1: Replace the full contents of `frontend/src/app/app/page.tsx`**

```tsx
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUserOrNull } from "@/features/auth/api/auth";
import { TaskCalendar } from "@/features/tasks/components/task-calendar";

export default async function AppPage() {
  const user = await getCurrentUserOrNull();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader user={user} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <TaskCalendar />
      </main>

      <SiteFooter />
    </div>
  );
}
```

This removes the direct `Wordmark`/`LogoutButton` imports the old inline header used — `SiteHeader` now owns both.

- [ ] **Step 2: Full verification**

```bash
npm test        # all suites green (expect the 69 pre-existing tests + 2 + 6 + 2 = 79 new/total)
npm run lint    # clean
npm run build   # compiles; still 9 routes (/, /_not-found, 4 /api/auth/*, /app, /login, /signup)
```

- [ ] **Step 3: Manual verification**

Run `npm run dev` and check `http://localhost:10050` (requires a login session — if one isn't available in this environment, note every item below as deferred to the user rather than skipping this step silently):

1. Logged out, visit `/`: header shows theme toggle + "Sign in"; hero shows "Get started" + "Sign in"; footer shows the wordmark, copyright, and a "GitHub profile" link to `https://github.com/jfloww` that opens in a new tab.
2. Log in, then visit `/`: header shows your name (or username/email, per the fallback) + "Sign out"; hero shows a single "Open app" button instead of the two prior buttons.
3. From `/app`, click the top-left wordmark: you land on `/`, not `/app` — confirm this both logged in and logged out.
4. Visit `/app`: header and footer render the same way as `/`; `TaskCalendar` still works (add/toggle a task).
5. With a valid session, delete only the `access_token` cookie via devtools (leave `refresh_token`), then reload `/`: the header should still show your signed-in state (silently refreshed) rather than reverting to "Sign in".

- [ ] **Step 4: Commit**

```bash
git add src/app/app/page.tsx
git commit -m "feat: wire SiteHeader/SiteFooter into the app workspace"
```
