# Landing + Auth Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/`, `/login`, and `/signup` in the approved "Tesla-minimal" design (spec: `docs/superpowers/specs/2026-07-15-landing-auth-design.md`) on Tailwind v4 + shadcn/ui, with dark mode as the default theme.

**Architecture:** Presentation-layer only — auth behavior (route handlers, middleware, cookies, Django API) does not change. One theme-token rewrite in `globals.css` feeds every shadcn component; three small shared components (`Wordmark`, `ThemeToggle`, `AuthLayout`) compose the pages. `next-themes` drives the `.dark` class with dark as default.

**Tech Stack:** Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui (base-nova preset, Base UI primitives), next-themes, lucide-react (installed), Geist font (wired in `layout.tsx`).

## Global Constraints

- Branch: work happens on `feat/landing-auth-design` (already checked out; spec committed there).
- Auth behavior unchanged: same endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/logout`), same redirect logic, same error message flow.
- Palette (exact values from spec) — light: background `#ffffff`, foreground `#171a1c`, secondary text `#5f6a72`, labels `#8b9299`, input fill `#f2f3f4`, hairline `#e5e7e6`, accent `#3b6b96`; dark: background `#0f1214`, surfaces `#171b1e`, text `#f3f5f6`, input fill `#22272b`, hairline `rgb(255 255 255 / 10%)`, accent `#6f9cc4`. Accent is used ONLY for wordmark "UP", focus rings, links, and the mock's active checkbox.
- Dark is the DEFAULT theme; toggle switches to light; choice persists (next-themes handles localStorage).
- No test framework exists in the frontend and none is added (per approved spec): verification = `npx tsc --noEmit`, `npm run build`, and manual browser checks against the dev servers (frontend port 10050, Django port 8000). No hardcoded config in code — env files are the single source of truth (user preference).
- The `/app` placeholder page is out of scope but must not visually break: its legacy CSS classes are kept, remapped to new tokens.
- Frontend dev server: `npm run dev` in `frontend/` (port 10050). Backend: `.venv\Scripts\python manage.py runserver` in `backend/` (port 8000).

---

### Task 1: Theme foundation (tokens, next-themes, dark default)

**Files:**
- Modify: `frontend/src/app/globals.css` (full rewrite)
- Create: `frontend/src/components/theme-provider.tsx`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: CSS tokens (`--brand`, `--subtle` + all shadcn tokens) exposed as Tailwind utilities `text-brand`, `border-brand`, `bg-brand/30`, `text-subtle`; `<ThemeProvider>` component (re-export of next-themes provider) already mounted in the root layout with dark default. Later tasks style with these utilities and assume dark-by-default.

- [ ] **Step 1: Install next-themes**

```bash
cd frontend
npm install next-themes
```

Expected: added to `dependencies` in `package.json`.

- [ ] **Step 2: Replace the entire contents of `frontend/src/app/globals.css` with:**

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

:root {
  color-scheme: light;
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #171a1c;
  --card: #ffffff;
  --card-foreground: #171a1c;
  --popover: #ffffff;
  --popover-foreground: #171a1c;
  --primary: #171a1c;
  --primary-foreground: #ffffff;
  --secondary: #f2f3f4;
  --secondary-foreground: #171a1c;
  --muted: #f2f3f4;
  --muted-foreground: #5f6a72;
  --accent: #f2f3f4;
  --accent-foreground: #171a1c;
  --destructive: #b42318;
  --border: #e5e7e6;
  --input: #f2f3f4;
  --ring: #3b6b96;
  --brand: #3b6b96;
  --subtle: #8b9299;
  --chart-1: #3b6b96;
  --chart-2: #5f6a72;
  --chart-3: #8b9299;
  --chart-4: #b9c0c4;
  --chart-5: #e5e7e6;
  --sidebar: #ffffff;
  --sidebar-foreground: #171a1c;
  --sidebar-primary: #171a1c;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f2f3f4;
  --sidebar-accent-foreground: #171a1c;
  --sidebar-border: #e5e7e6;
  --sidebar-ring: #3b6b96;
}

.dark {
  color-scheme: dark;
  --background: #0f1214;
  --foreground: #f3f5f6;
  --card: #171b1e;
  --card-foreground: #f3f5f6;
  --popover: #171b1e;
  --popover-foreground: #f3f5f6;
  --primary: #f3f5f6;
  --primary-foreground: #0f1214;
  --secondary: #22272b;
  --secondary-foreground: #f3f5f6;
  --muted: #22272b;
  --muted-foreground: #a6afb5;
  --accent: #22272b;
  --accent-foreground: #f3f5f6;
  --destructive: #ff8a7a;
  --border: rgb(255 255 255 / 10%);
  --input: #22272b;
  --ring: #6f9cc4;
  --brand: #6f9cc4;
  --subtle: #7b858c;
  --chart-1: #6f9cc4;
  --chart-2: #a6afb5;
  --chart-3: #7b858c;
  --chart-4: #4a5258;
  --chart-5: #22272b;
  --sidebar: #171b1e;
  --sidebar-foreground: #f3f5f6;
  --sidebar-primary: #f3f5f6;
  --sidebar-primary-foreground: #0f1214;
  --sidebar-accent: #22272b;
  --sidebar-accent-foreground: #f3f5f6;
  --sidebar-border: rgb(255 255 255 / 10%);
  --sidebar-ring: #6f9cc4;
}

@theme inline {
  --font-heading: var(--font-sans);
  --font-sans: var(--font-sans);
  --color-brand: var(--brand);
  --color-subtle: var(--subtle);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}

/* --- Legacy styles for the /app placeholder only. ---
   The /app restyle is a tracked follow-up in the design spec; these keep the
   placeholder presentable on the new tokens. Do not use these classes in new code. */

.app-shell {
  min-height: 100vh;
  padding: 24px;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 auto;
  max-width: 1120px;
}

.app-main {
  display: grid;
  gap: 16px;
  grid-template-columns: 240px minmax(0, 1fr);
  margin: 24px auto 0;
  max-width: 1120px;
}

.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  padding: 20px;
}

.nav-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-list a {
  display: block;
  border-radius: 8px;
  color: var(--foreground);
  font-weight: 600;
  padding: 8px 10px;
  text-decoration: none;
}

.nav-list a:hover {
  background: var(--muted);
}

.eyebrow {
  color: var(--brand);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin: 0;
}

@media (max-width: 720px) {
  .app-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .app-main {
    grid-template-columns: 1fr;
  }
}
```

Note what is being deleted relative to the old file: all old `--surface/--text/--accent(-strong)/--danger*/--focus-ring/--shadow` variables, the `@media (prefers-color-scheme: dark)` block (next-themes' `.dark` class replaces it), the bare `button`/`input`/`a` element styles (they fight shadcn components), and all `.auth-*`/`.form-error` classes (auth pages are rebuilt in Task 3).

- [ ] **Step 3: Create `frontend/src/components/theme-provider.tsx`:**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(
  props: React.ComponentProps<typeof NextThemesProvider>,
) {
  return <NextThemesProvider {...props} />;
}
```

- [ ] **Step 4: Replace the contents of `frontend/src/app/layout.tsx` with:**

```tsx
import type { Metadata } from "next";

import "./globals.css";
import { Geist } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Picking Up",
  description: "A practical task workspace for web first and iPhone later.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` is required: next-themes mutates the `<html>` class before hydration. `enableSystem={false}` + `defaultTheme="dark"` = dark by default per spec.

- [ ] **Step 5: Verify build**

```bash
cd frontend
npx tsc --noEmit && npm run build
```

Expected: both exit 0. (The old pages still reference deleted classes like `auth-page` — classes that no longer exist just render unstyled; the build must still pass.)

- [ ] **Step 6: Visual smoke check**

Start `npm run dev` (port 10050), open `http://localhost:10050/login`. Expected: near-black `#0f1214` background (dark default active), unstyled-looking form (rebuilt in Task 3). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/layout.tsx frontend/src/components/theme-provider.tsx frontend/package.json frontend/package-lock.json frontend/postcss.config.mjs frontend/components.json frontend/src/components/ui frontend/src/lib/utils.ts .gitignore
git commit -m "feat: theme foundation - tokens, next-themes, dark default"
```

(This commit also picks up the previously-uncommitted Tailwind/shadcn setup files.)

---

### Task 2: Shared brand components (Wordmark, ThemeToggle, AuthLayout)

**Files:**
- Create: `frontend/src/components/wordmark.tsx`
- Create: `frontend/src/components/theme-toggle.tsx`
- Create: `frontend/src/components/auth-layout.tsx`

**Interfaces:**
- Consumes: `text-brand`/`text-subtle` utilities and ThemeProvider from Task 1; `Button` from `@/components/ui/button`.
- Produces: `<Wordmark className?>` (a `next/link` to `/`), `<ThemeToggle />` (client component, no props), `<AuthLayout>{children}</AuthLayout>` (server component, renders header + centered 360px column). Tasks 3–4 import all three by these exact names from `@/components/wordmark`, `@/components/theme-toggle`, `@/components/auth-layout`.

- [ ] **Step 1: Create `frontend/src/components/wordmark.tsx`:**

```tsx
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "text-xs font-semibold tracking-[0.3em] text-foreground",
        className,
      )}
    >
      PICKING&nbsp;<span className="text-brand">UP</span>
    </Link>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/theme-toggle.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="icon" className="rounded-full" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
```

The `mounted` guard prevents a hydration mismatch (server doesn't know the persisted theme).

- [ ] **Step 3: Create `frontend/src/components/auth-layout.tsx`:**

```tsx
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pt-[10vh] pb-16">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Verify compile**

```bash
cd frontend
npx tsc --noEmit
```

Expected: exit 0. (Components are not rendered anywhere yet; visual verification happens in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wordmark.tsx frontend/src/components/theme-toggle.tsx frontend/src/components/auth-layout.tsx
git commit -m "feat: wordmark, theme toggle, and auth layout components"
```

---

### Task 3: Rebuild auth form and both auth pages

**Files:**
- Modify: `frontend/src/features/auth/components/auth-form.tsx` (full rewrite)
- Modify: `frontend/src/app/login/page.tsx` (full rewrite)
- Modify: `frontend/src/app/signup/page.tsx` (full rewrite)
- Modify: `frontend/src/features/auth/components/logout-button.tsx` (swap bare `<button>` for shadcn `Button` — the global `button` element style it relied on was deleted in Task 1)

**Interfaces:**
- Consumes: `AuthLayout` from Task 2; `Button`, `Input`, `Label`, `Alert`, `AlertTitle` from `@/components/ui/*`.
- Produces: `AuthForm({ mode: "login" | "signup" })` — same export name and props as before, so no other file changes. Signup gains a confirm-password field (client-side match check only; API contract unchanged).

- [ ] **Step 1: Replace the contents of `frontend/src/features/auth/components/auth-form.tsx` with:**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthFormProps = {
  mode: "login" | "signup";
};

const inputClassName =
  "h-11 rounded-lg border-transparent bg-muted focus-visible:border-ring";

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    if (!isLogin && password !== String(formData.get("confirm-password") ?? "")) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Authentication failed.");
      }

      if (isLogin) {
        router.replace(searchParams.get("next") ?? "/app");
      } else {
        router.replace("/login");
      }

      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Authentication failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <h1 className="text-3xl font-extralight tracking-tight text-foreground">
        {isLogin ? "Sign in" : "Create account"}
      </h1>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email" className="text-subtle">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClassName}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-subtle">
          Password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
          className={inputClassName}
        />
      </div>

      {!isLogin ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password" className="text-subtle">
            Confirm password
          </Label>
          <Input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClassName}
          />
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        size="lg"
        className="mt-1 w-full rounded-full"
      >
        {isSubmitting ? "Working..." : isLogin ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
```

Behavior notes: fetch/redirect/error logic is byte-for-byte the old flow; the only functional addition is the confirm-password match check (before `setIsSubmitting`, so a mismatch never hits the network).

- [ ] **Step 2: Replace the contents of `frontend/src/app/login/page.tsx` with:**

```tsx
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="text-brand underline underline-offset-4">
          Create account
        </Link>
      </p>
    </AuthLayout>
  );
}
```

- [ ] **Step 3: Replace the contents of `frontend/src/app/signup/page.tsx` with:**

```tsx
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function SignupPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-brand underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Replace the contents of `frontend/src/features/auth/components/logout-button.tsx` with:**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleLogout} type="button">
      {isPending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
```

- [ ] **Step 5: Verify compile and build**

```bash
cd frontend
npx tsc --noEmit && npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Manual flow verification (both servers running)**

Terminal 1: `cd backend && .venv\Scripts\python manage.py runserver`
Terminal 2: `cd frontend && npm run dev`

Check at `http://localhost:10050`:
1. `/login` in dark default: near-black page, wordmark top-left with blue "UP", sun icon top-right, light-weight "Sign in" heading, gray-filled inputs, white pill button.
2. Click toggle → light mode: white page, black pill button. Reload → still light (persisted). Toggle back to dark.
3. Login with wrong password → destructive Alert appears above the form with the API's error message.
4. `/signup` → create a throwaway user (e.g. `ui-test@example.com` / `UiTest2026!Pass`) with mismatched confirm password first → "Passwords do not match." alert, no network call. Then matching → redirected to `/login`.
5. Log in with the new user → lands on `/app`. Click "Sign out" (now an outline Button) → back to `/login`.
6. Narrow the window to ~375px → auth column fills width with padding, nothing overflows.

Expected: all pass. Delete the throwaway user afterward:
`cd backend && .venv\Scripts\python manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(email='ui-test@example.com').delete()"`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/auth/components/auth-form.tsx frontend/src/features/auth/components/logout-button.tsx frontend/src/app/login/page.tsx frontend/src/app/signup/page.tsx
git commit -m "feat: rebuild login and signup pages in Tesla-minimal design"
```

---

### Task 4: Landing page

**Files:**
- Modify: `frontend/src/app/page.tsx` (replace the redirect with the landing page)
- Create: `frontend/src/components/task-mock.tsx`

**Interfaces:**
- Consumes: `Wordmark`, `ThemeToggle` from Task 2; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- Produces: the public landing at `/`. `TaskMock` is decorative (`aria-hidden`) and will be replaced by a real screenshot later (tracked spec follow-up). Note: `/` currently redirects to `/app` — that redirect is deleted; middleware still protects `/app` itself, so nothing else changes.

- [ ] **Step 1: Create `frontend/src/components/task-mock.tsx`:**

```tsx
import { cn } from "@/lib/utils";

const navItems = ["Today", "Inbox", "Done"];

const rows = [
  { label: "Reply to the design review", done: true, active: false },
  { label: "Book dentist appointment", done: false, active: true },
  { label: "Prepare Monday standup notes", done: false, active: false },
  { label: "Pick up groceries", done: false, active: false },
];

export function TaskMock() {
  return (
    <div
      aria-hidden
      className="rounded-t-xl border border-b-0 border-border bg-card p-4 shadow-[0_-16px_64px_-24px_rgb(0_0_0/0.4)] sm:p-6"
    >
      <div className="flex gap-5">
        <div className="hidden w-40 shrink-0 flex-col gap-1 sm:flex">
          {navItems.map((item, index) => (
            <div
              key={item}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                index === 0
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {item}
            </div>
          ))}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
            >
              <span
                className={cn(
                  "size-4 shrink-0 rounded-full border",
                  row.done && "border-transparent bg-brand/40",
                  row.active && "border-brand",
                  !row.done && !row.active && "border-border",
                )}
              />
              <span
                className={cn(
                  "truncate text-sm",
                  row.done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the contents of `frontend/src/app/page.tsx` with:**

```tsx
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TaskMock } from "@/components/task-mock";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "rounded-full px-4",
            )}
          >
            Sign in
          </Link>
        </div>
      </header>

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
          </div>
        </section>

        <section className="mx-auto mt-14 w-full max-w-4xl px-6">
          <TaskMock />
        </section>
      </main>

      <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
        <Wordmark className="opacity-60" />
        <p className="text-xs text-muted-foreground">© 2026 Picking Up</p>
      </footer>
    </div>
  );
}
```

(`buttonVariants` + `Link` is used instead of `<Button>` because these are navigations, not actions — real links get right-click/middle-click behavior for free.)

- [ ] **Step 3: Verify compile and build**

```bash
cd frontend
npx tsc --noEmit && npm run build
```

Expected: both exit 0, and the route table shows `/` as a static page (○), not a redirect.

- [ ] **Step 4: Manual verification (frontend dev server running)**

At `http://localhost:10050/`:
1. Dark default: near-black page, wordmark + toggle + "Sign in" pill in nav, ultra-light headline, white "Get started" pill, task mock framed at the bottom with one blue-circled row.
2. Toggle to light → everything inverts cleanly; the mock's hairline frame and shadow still look intentional.
3. "Get started" → `/signup`; nav "Sign in" → `/login`.
4. ~375px width: headline scales down (text-4xl), sidebar inside the mock disappears (sm:flex), no horizontal scrolling.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/components/task-mock.tsx
git commit -m "feat: Tesla-minimal landing page with task mock hero"
```

---

### Task 5: Final verification sweep and docs

**Files:**
- Modify: `docs/planning/5. auth-todo.md` (note the redesign under Current Auth Shape is unaffected; add hero-screenshot follow-up)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified, documented branch ready for PR.

- [ ] **Step 1: Full clean build**

```bash
cd frontend
npx tsc --noEmit && npm run build
```

Expected: exit 0, no warnings about missing classes/hydration.

- [ ] **Step 2: Full auth regression pass (both servers running)**

The complete matrix once more, end to end: signup (with mismatch first) → login wrong password (alert) → login correct (lands on `/app`, still legible on legacy styles) → sign out → login page again. Also confirm `/` no longer redirects, and that visiting `/app` logged-out still bounces to `/login?next=/app` (middleware untouched). Clean up any test user created (see Task 3 Step 6 for the delete command).

- [ ] **Step 3: Backend tests still green (proves no accidental behavior change)**

```bash
cd backend
.venv\Scripts\python manage.py test apps.accounts
```

Expected: `OK`, 3 tests.

- [ ] **Step 4: Add the follow-up note to `docs/planning/5. auth-todo.md`** — append to the "Defer Until Later" list:

```markdown
- [ ] Replace landing-page task mock with a real task-UI screenshot (after the task workspace is built).
- [ ] Restyle the /app placeholder onto the shadcn token system.
```

- [ ] **Step 5: Commit and offer PR**

```bash
git add "docs/planning/5. auth-todo.md"
git commit -m "docs: track landing hero screenshot and /app restyle follow-ups"
git log --oneline main..HEAD
```

Expected: the spec commits plus one commit per task. Then offer the user a PR from `feat/landing-auth-design` to `main` (do not push without asking).
