# Footer Version Info & Login Loading Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show build/version info (frontend footer, backend health endpoint, a diagnostics page comparing both) and add visible loading feedback across the login flow (email/password submit, Google sign-in, and the post-login `/planner` render gap).

**Architecture:** Backend gains a `/api/health/` JSON endpoint (an existing stub, extended) sourcing its version from a committed `backend/VERSION` file and its commit/environment from new env vars. The frontend footer shows its own `package.json` version + Vercel's built-in commit-SHA env var with no live backend call; a new `/diagnostics` page and its own BFF route are the only thing that fetches and compares both sides. Login loading feedback is three small, independent additions reusing one visual language (`lucide-react`'s `Loader2` + `animate-spin`): the existing `AuthForm` submit button, `GoogleSignInButton` (which has none today), and a new Next.js App Router `loading.tsx` for `/planner`.

**Tech Stack:** Django 5 + DRF (backend), Next.js 15 App Router + React 19 + TypeScript (frontend), Vitest + Testing Library (frontend tests), Django's `TestCase` (backend tests).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-07-footer-version-and-login-loading-design.md`. Every rule below traces to a section there.
- No frontend/backend version-compatibility enforcement anywhere — every new piece is informational only, never blocking.
- No `NEXT_PUBLIC_`-prefixed env vars are needed anywhere in this plan — every place that reads `VERCEL_GIT_COMMIT_SHA` or `package.json`'s version is a React Server Component (no `"use client"`), so server-side env access is sufficient.
- `backend/config/urls.py` already registers `path("api/health/", health, name="health")` importing `health` from `backend/config/views.py`. **Modify the existing `health` function in place** — do not create a second view or a duplicate route.
- Backend env vars follow this codebase's existing `django-environ` / `DJANGO_`-prefixed convention (`DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`): `DJANGO_GIT_SHA` (default `"unknown"`), `DJANGO_ENVIRONMENT` (default `"development"`).
- Every new frontend BFF route follows the exact shape already used by `frontend/src/app/api/categories/route.ts` and `frontend/src/app/api/auth/google/route.ts`: `apiRequest<T>(path, options)` from `@/lib/api/server` for the outbound call (omit `authenticated: true` — the health endpoint needs no auth), and `apiRouteErrorResponse(error, fallbackMessage)` from `@/lib/api/route-error` for the error path.
- Backend tests run via: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test config -v 2` from `backend/` for the health-endpoint tests specifically (mirrors the existing `backend/config/test_middleware.py`'s own test target), and `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test config apps -v 1` for a full regression pass at the end.
- Frontend tests run via `npx vitest run <path>` from `frontend/`.

---

## File Structure

**Backend (`backend/`):**
- `VERSION` (new) — single-line file holding the app's own semver, e.g. `0.1.0`.
- `config/settings.py` — add `APP_VERSION`, `DJANGO_GIT_SHA`, `DJANGO_ENVIRONMENT`.
- `config/views.py` — extend the existing `health` view to return the full JSON shape.
- `config/test_views.py` (new) — tests for the extended `health` view.

**Frontend (`frontend/src/`):**
- `components/site-footer.tsx` — show `v{package.json version}`, plus a short commit SHA when `VERCEL_GIT_COMMIT_SHA` is set, linking to `/diagnostics`.
- `components/site-footer.test.tsx` — extend with version/commit assertions.
- `lib/api/health.ts` (new) — `requestHealth()`, the server-side wrapper around Django's `/api/health/`, following the same shape as `features/tasks/api/categories.ts`'s request functions.
- `app/api/health/route.ts` (new) + `app/api/health/route.test.ts` (new) — the BFF route proxying `requestHealth()`.
- `app/diagnostics/page.tsx` (new) + `app/diagnostics/page.test.tsx` (new) — server component comparing frontend and backend build info.
- `features/auth/components/auth-form.tsx` — swap the submit button's "Working..." text for a spinner + mode-specific text.
- `features/auth/components/auth-form.test.tsx` (new — no test file exists for this component today; this plan only adds coverage for the loading-state change being made here).
- `features/auth/components/google-sign-in-button.tsx` — add loading state + a reentrancy guard around the credential callback.
- `features/auth/components/google-sign-in-button.test.tsx` — extend with two new tests.
- `app/planner/loading.tsx` (new) + `app/planner/loading.test.tsx` (new) — Next.js App Router loading UI for the `/planner` route segment.

---

## Task 1: Backend — extend the health endpoint

**Files:**
- Modify: `backend/config/settings.py`
- Modify: `backend/config/views.py`
- Create: `backend/VERSION`
- Test: `backend/config/test_views.py`

**Interfaces:**
- Produces: `settings.APP_VERSION: str`, `settings.DJANGO_GIT_SHA: str`, `settings.DJANGO_ENVIRONMENT: str` — read by `health()`. The response shape `{"status": "ok", "service": "picking-up-api", "version": str, "commit": str, "environment": str}` is what Task 3's `requestHealth()` on the frontend expects to receive verbatim (same field names, no snake_case↔camelCase mapping needed since this endpoint is health/build metadata, not domain data).

- [ ] **Step 1: Write the failing tests**

Create `backend/config/test_views.py`:

```python
from django.test import TestCase, override_settings


class HealthViewTests(TestCase):
    def test_returns_ok_status_service_name_and_exactly_the_expected_keys(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "picking-up-api")
        self.assertEqual(
            set(data.keys()), {"status", "service", "version", "commit", "environment"}
        )

    def test_returns_the_configured_version_commit_and_environment(self):
        with override_settings(
            APP_VERSION="9.9.9", DJANGO_GIT_SHA="deadbee", DJANGO_ENVIRONMENT="staging"
        ):
            response = self.client.get("/api/health/")

        data = response.json()
        self.assertEqual(data["version"], "9.9.9")
        self.assertEqual(data["commit"], "deadbee")
        self.assertEqual(data["environment"], "staging")
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test config.test_views -v 2` from `backend/`.
Expected: `test_returns_ok_status_service_name_and_exactly_the_expected_keys` FAILS (the current response only has `{"status": "ok"}`, missing `service`/`version`/`commit`/`environment`). `test_returns_the_configured_version_commit_and_environment` FAILS with an `AttributeError` or similar, since `settings.APP_VERSION` doesn't exist yet for `override_settings` to override.

- [ ] **Step 3: Create `backend/VERSION`**

Create `backend/VERSION` with exactly this content (one line, no leading/trailing whitespace beyond the final newline):

```
0.1.0
```

- [ ] **Step 4: Add the three new settings to `config/settings.py`**

In `backend/config/settings.py`, immediately after the existing block that ends with the `ImproperlyConfigured` check for `SECRET_KEY` (currently lines 20-28, ending with the `)` that closes the `raise ImproperlyConfigured(...)` call) and before `ALLOWED_HOSTS = env.list(...)`, add:

```python
APP_VERSION = (BASE_DIR / "VERSION").read_text().strip()
DJANGO_GIT_SHA = env("DJANGO_GIT_SHA", default="unknown")
DJANGO_ENVIRONMENT = env("DJANGO_ENVIRONMENT", default="development")
```

- [ ] **Step 5: Extend the `health` view in `config/views.py`**

Replace the entire contents of `backend/config/views.py` (currently just the bare stub) with:

```python
from django.conf import settings
from django.http import JsonResponse


def health(request):
    return JsonResponse(
        {
            "status": "ok",
            "service": "picking-up-api",
            "version": settings.APP_VERSION,
            "commit": settings.DJANGO_GIT_SHA,
            "environment": settings.DJANGO_ENVIRONMENT,
        }
    )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test config -v 2` from `backend/`.
Expected: PASS, both new tests plus the existing `config.test_middleware` tests unaffected.

- [ ] **Step 7: Commit**

```bash
git add backend/VERSION backend/config/settings.py backend/config/views.py backend/config/test_views.py
git commit -m "feat: extend /api/health with app version, commit, and environment"
```

---

## Task 2: Frontend — footer shows its own version and commit

**Files:**
- Modify: `frontend/src/components/site-footer.tsx`
- Test: `frontend/src/components/site-footer.test.tsx`

**Interfaces:**
- Consumes: `frontend/package.json`'s `version` field (already `"0.1.0"`); `process.env.VERCEL_GIT_COMMIT_SHA` (Vercel-provided, no configuration needed; unset in local dev and any non-Vercel host).
- Produces: nothing consumed by a later task — this task's link target (`/diagnostics`) is created by Task 3, but `SiteFooter` doesn't import anything from it, only an `href` string, so this task has no ordering dependency on Task 3.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/site-footer.test.tsx`, change the import line from:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";
```

to:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SiteFooter } from "./site-footer";
import packageJson from "../../package.json";
```

Add two new tests inside the existing `describe("SiteFooter", ...)` block, after the existing two tests:

```typescript
  it("shows the package version, linking to /diagnostics", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: `v${packageJson.version}` });
    expect(link.getAttribute("href")).toBe("/diagnostics");
  });

  it("includes a short commit SHA in the link text when VERCEL_GIT_COMMIT_SHA is set", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a84c20fdeadbeef1234567890abcdef12345678");
    render(<SiteFooter />);
    expect(
      screen.getByRole("link", { name: `v${packageJson.version} (a84c20f)` }),
    ).toBeTruthy();
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/components/site-footer.test.tsx` from `frontend/`.
Expected: FAIL — no link with the version text exists yet.

- [ ] **Step 3: Update `SiteFooter`**

Replace the full contents of `frontend/src/components/site-footer.tsx` with:

```typescript
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

import packageJson from "../../package.json";

export function SiteFooter() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const versionLabel = commitSha
    ? `v${packageJson.version} (${commitSha.slice(0, 7)})`
    : `v${packageJson.version}`;

  return (
    <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
      <Wordmark className="opacity-60" />
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">
          © 2026 JFLOWW ·{" "}
          <a href="/diagnostics" className="hover:text-foreground hover:underline">
            {versionLabel}
          </a>
        </p>
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/site-footer.test.tsx` from `frontend/`.
Expected: PASS, all 4 tests (2 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/site-footer.tsx frontend/src/components/site-footer.test.tsx
git commit -m "feat: show the app version and commit SHA in the site footer"
```

---

## Task 3: Frontend — backend health BFF route and diagnostics page

**Files:**
- Create: `frontend/src/lib/api/health.ts`
- Create: `frontend/src/app/api/health/route.ts`
- Test: `frontend/src/app/api/health/route.test.ts`
- Create: `frontend/src/app/diagnostics/page.tsx`
- Test: `frontend/src/app/diagnostics/page.test.tsx`

**Interfaces:**
- Consumes (Task 1): the backend's `/api/health/` response shape
  `{ status: string; service: string; version: string; commit: string; environment: string }`.
- Consumes: `apiRequest<T>(path, options)` and `apiRouteErrorResponse(error, fallbackMessage)`, both already in the codebase (`frontend/src/lib/api/server.ts`, `frontend/src/lib/api/route-error.ts`).
- Produces: `requestHealth(): Promise<BackendHealth>` from `frontend/src/lib/api/health.ts`, used directly by both the new BFF route and the new diagnostics page.

The diagnostics page calls `requestHealth()` directly (a server-to-server call — it's a Server Component, so no browser request happens at all here) rather than fetching its own `/api/health` BFF route over HTTP. A Next.js Server Component self-fetching its own app's API route is a known anti-pattern (it needs an absolute URL, which is awkward and environment-dependent) — the BFF route exists as its own independently useful, independently tested deliverable (a real same-origin endpoint any future browser-side code, external tool, or monitoring check can hit), not as something this page needs to chain through.

- [ ] **Step 1: Write the failing tests for `lib/api/health.ts` and the BFF route**

Create `frontend/src/app/api/health/route.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies the backend's health response", async () => {
    const backendHealth = {
      status: "ok",
      service: "picking-up-api",
      version: "0.1.0",
      commit: "a84c20f",
      environment: "production",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(backendHealth)));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(backendHealth);
  });

  it("returns the backend's error status and message when it's unreachable or failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Backend down." }, 502)),
    );

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Backend down." });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/app/api/health/route.test.ts` from `frontend/`.
Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement `lib/api/health.ts`**

Create `frontend/src/lib/api/health.ts`:

```typescript
import { apiRequest } from "./server";

export interface BackendHealth {
  status: string;
  service: string;
  version: string;
  commit: string;
  environment: string;
}

export async function requestHealth(): Promise<BackendHealth> {
  return apiRequest<BackendHealth>("/api/health/");
}
```

- [ ] **Step 4: Implement the BFF route**

Create `frontend/src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

import { requestHealth } from "@/lib/api/health";
import { apiRouteErrorResponse } from "@/lib/api/route-error";

export async function GET() {
  try {
    const health = await requestHealth();
    return NextResponse.json(health);
  } catch (error) {
    return apiRouteErrorResponse(error, "Failed to reach the backend.");
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/api/health/route.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 6: Write the failing test for the diagnostics page**

Create `frontend/src/app/diagnostics/page.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DiagnosticsPage from "./page";
import packageJson from "../../../package.json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DiagnosticsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows the frontend and backend version, commit, and environment side by side", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a84c20fdeadbeef1234567890abcdef12345678");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "ok",
          service: "picking-up-api",
          version: "0.1.0",
          commit: "1a2b3c4deadbeef1234567890abcdef12345678",
          environment: "production",
        }),
      ),
    );

    render(await DiagnosticsPage());

    expect(screen.getByText(`${packageJson.version} (a84c20f)`)).toBeTruthy();
    expect(screen.getByText("0.1.0 (1a2b3c4) · production")).toBeTruthy();
  });

  it("shows an unavailable message when the backend cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Backend down." }, 502)),
    );

    render(await DiagnosticsPage());

    expect(screen.getByText(/unavailable — Backend down\./)).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run the test to confirm it fails**

Run: `npx vitest run src/app/diagnostics/page.test.tsx` from `frontend/`.
Expected: FAIL — `./page` doesn't exist yet.

- [ ] **Step 8: Implement the diagnostics page**

Create `frontend/src/app/diagnostics/page.tsx`:

```typescript
import { requestHealth } from "@/lib/api/health";
import packageJson from "../../../package.json";

export default async function DiagnosticsPage() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const frontendCommit = commitSha ? commitSha.slice(0, 7) : "unknown";

  let backend: { version: string; commit: string; environment: string } | null = null;
  let backendError: string | null = null;
  try {
    backend = await requestHealth();
  } catch (error) {
    backendError = error instanceof Error ? error.message : "Failed to reach the backend.";
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Diagnostics</h1>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Frontend</dt>
          <dd className="font-mono">
            {packageJson.version} ({frontendCommit})
          </dd>
        </div>
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Backend</dt>
          <dd className="font-mono">
            {backend
              ? `${backend.version} (${backend.commit.slice(0, 7)}) · ${backend.environment}`
              : `unavailable — ${backendError}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/app/diagnostics/page.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/api/health.ts frontend/src/app/api/health/route.ts frontend/src/app/api/health/route.test.ts frontend/src/app/diagnostics/page.tsx frontend/src/app/diagnostics/page.test.tsx
git commit -m "feat: add a backend health BFF route and a diagnostics page comparing build info"
```

---

## Task 4: Frontend — `AuthForm` submit-button loading feedback

**Files:**
- Modify: `frontend/src/features/auth/components/auth-form.tsx`
- Test: `frontend/src/features/auth/components/auth-form.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/auth/components/auth-form.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AuthForm } from "./auth-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AuthForm loading state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a spinner and 'Signing in…' while a login submission is in flight, then clears it", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText("Signing in…")).toBeTruthy();
    expect(screen.getByRole("button")).toBeDisabled();

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.queryByText("Signing in…")).toBeNull());
  });

  it("shows 'Creating account…' while a signup submission is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "password123" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText("Creating account…")).toBeTruthy();

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.queryByText("Creating account…")).toBeNull());
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/auth/components/auth-form.test.tsx` from `frontend/`.
Expected: FAIL — the button currently shows "Working..." while submitting, not "Signing in…"/"Creating account…".

- [ ] **Step 3: Update `AuthForm`**

In `frontend/src/features/auth/components/auth-form.tsx`, add to the imports:

```typescript
import { Loader2 } from "lucide-react";
```

Change the submit button (currently):

```typescript
      <Button
        type="submit"
        disabled={isSubmitting}
        size="lg"
        className="mt-1 w-full rounded-full"
      >
        {isSubmitting ? "Working..." : isLogin ? "Sign in" : "Create account"}
      </Button>
```

to:

```typescript
      <Button
        type="submit"
        disabled={isSubmitting}
        size="lg"
        className="mt-1 w-full rounded-full"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {isLogin ? "Signing in…" : "Creating account…"}
          </span>
        ) : isLogin ? (
          "Sign in"
        ) : (
          "Create account"
        )}
      </Button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/auth/components/auth-form.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/auth/components/auth-form.tsx frontend/src/features/auth/components/auth-form.test.tsx
git commit -m "feat: show a spinner and specific status text on the auth form's submit button"
```

---

## Task 5: Frontend — `GoogleSignInButton` loading feedback

**Files:**
- Modify: `frontend/src/features/auth/components/google-sign-in-button.tsx`
- Test: `frontend/src/features/auth/components/google-sign-in-button.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by a later task.

The reentrancy guard uses a `useRef` (not the `isSubmitting` state) so that reading it inside the `initialize` callback never needs `isSubmitting` in the surrounding `useEffect`'s dependency array — adding it there would re-run the effect (re-registering the Google button and its callback) every time submission starts or stops, which would visibly re-render Google's widget mid-flow. The ref is read/written without triggering re-renders or effect re-runs; the separate `isSubmitting` state exists purely to drive the visible spinner.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/auth/components/google-sign-in-button.test.tsx`, add two new tests inside the existing `describe("GoogleSignInButton", ...)` block, after the existing `"redirects on a successful credential callback"` test:

```typescript
  it("shows a loading indicator while the credential callback is in flight", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    const callbackPromise = callback({ credential: "id-token" });

    expect(await screen.findByText("Signing in…")).toBeTruthy();

    resolveFetch(jsonResponse({ ok: true }));
    await callbackPromise;
  });

  it("ignores a second callback invocation while the first is still in flight", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    const firstCall = callback({ credential: "id-token" });
    callback({ credential: "id-token" });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ ok: true }));
    await firstCall;
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/auth/components/google-sign-in-button.test.tsx` from `frontend/`.
Expected: FAIL — no "Signing in…" text exists anywhere yet, and there is no reentrancy guard, so `fetchMock` would be called twice in the second test.

- [ ] **Step 3: Update `GoogleSignInButton`**

In `frontend/src/features/auth/components/google-sign-in-button.tsx`, add to the imports:

```typescript
import { Loader2 } from "lucide-react";
```

Change the component's state/effect setup (currently):

```typescript
export function GoogleSignInButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!scriptLoaded || !clientId || !window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        setError(undefined);
        const result = await submitGoogleCredential(response.credential);

        if (!result.ok) {
          setError(result.error);
          return;
        }

        router.replace(safeAuthRedirect(searchParams.get("next")));
        router.refresh();
      },
    });
```

to:

```typescript
export function GoogleSignInButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!scriptLoaded || !clientId || !window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setError(undefined);
        const result = await submitGoogleCredential(response.credential);

        if (!result.ok) {
          setError(result.error);
          isSubmittingRef.current = false;
          setIsSubmitting(false);
          return;
        }

        router.replace(safeAuthRedirect(searchParams.get("next")));
        router.refresh();
      },
    });
```

Change the render's error slot (currently):

```typescript
        <div ref={containerRef} />
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : null}
```

to:

```typescript
        <div ref={containerRef} />
        {isSubmitting ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </span>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/auth/components/google-sign-in-button.test.tsx` from `frontend/`.
Expected: PASS, all tests (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/auth/components/google-sign-in-button.tsx frontend/src/features/auth/components/google-sign-in-button.test.tsx
git commit -m "feat: show loading feedback and guard re-entrancy on Google sign-in"
```

---

## Task 6: Frontend — `/planner` route loading state

**Files:**
- Create: `frontend/src/app/planner/loading.tsx`
- Test: `frontend/src/app/planner/loading.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by a later task. This is a plain Next.js App Router convention file — Next.js discovers and wraps `frontend/src/app/planner/page.tsx` (an async Server Component) in a Suspense boundary automatically because this sibling file exists; no code elsewhere needs to import or reference it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/planner/loading.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PlannerLoading from "./loading";

describe("PlannerLoading", () => {
  it("shows a spinner and loading text", () => {
    render(<PlannerLoading />);
    expect(screen.getByText("Loading your planner…")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/app/planner/loading.test.tsx` from `frontend/`.
Expected: FAIL — `./loading` doesn't exist yet.

- [ ] **Step 3: Implement `loading.tsx`**

Create `frontend/src/app/planner/loading.tsx`:

```typescript
import { Loader2 } from "lucide-react";

export default function PlannerLoading() {
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading your planner…</p>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/planner/loading.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite and `tsc` for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures beyond whatever was already failing before this plan started.

Run: `npx tsc --noEmit` from `frontend/`.
Expected: clean.

Run: `npx next lint` from `frontend/`.
Expected: no new errors (existing warnings tracked separately are fine).

- [ ] **Step 6: Run the full backend suite for regressions**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test config apps -v 1` from `backend/`.
Expected: no new failures beyond whatever was already failing before this plan started.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/planner/loading.tsx frontend/src/app/planner/loading.test.tsx
git commit -m "feat: add a loading state for the /planner route segment"
```
