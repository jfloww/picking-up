# Task Sync Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the task app's persistence from browser localStorage to the already-shipped Django `tasks` API (PR #31), so tasks sync across devices for the already-required-to-be-logged-in user, with a one-time automatic import of whatever's already in localStorage.

**Architecture:** Follows the existing auth flow's BFF pattern exactly — a server-side request/mapping layer (`features/tasks/api/`) used only by thin Next.js Route Handlers (`app/api/tasks/*`), and a client-side `TaskRepository` implementation (`data/api-task-repository.ts`) that calls those local routes via same-origin `fetch` (the browser sends the httpOnly auth cookie automatically; the client never touches a token or a snake_case field name). `store.tsx` changes only to add error-surfacing on failed writes — no scheduling logic (rollover/routine materialization) is touched.

**Tech Stack:** Next.js 15 (App Router, async route params), TypeScript, Vitest + Testing Library. All commands run from `frontend/`.

## Global Constraints

- Field mapping (camelCase `Task` ↔ snake_case API fields) lives entirely in `features/tasks/api/mapping.ts` and `features/tasks/api/tasks.ts` — both server-side only (the latter reads the auth cookie via `next/headers`, which cannot run in the browser). The client-side repository (`data/api-task-repository.ts`) must never construct or parse a snake_case field name itself.
- Route handlers (`app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`) stay thin pass-throughs and are **not** unit tested, matching the existing, deliberate convention for `app/api/auth/*/route.ts` (verified: no `route.test.*` file exists anywhere in this codebase today). The logic they call (`features/tasks/api/tasks.ts`) is what's tested.
- The Next.js route handling `POST /api/tasks/` must translate the backend's duplicate-id `400` into a distinct `409 Conflict` response — this is what lets the client-side migration logic distinguish "already migrated, tolerate" from "a genuine validation failure, stop and retry later" without parsing Django's raw error body shape on the client.
- Migration (see Task 2) is triggered by localStorage's own presence, not by whether the server list is empty — gating on an empty server list breaks retry safety after a partial failure (a fuller explanation is in the design spec's Migration section; don't re-derive a different trigger).
- Every existing `store.tsx` action's `void repo.X(...)` fire-and-forget call becomes `repo.X(...).catch(handleSyncFailure)` — every one, not just some; a follow-on task's per-task-gate reviewer will check for this specifically.
- No changes to `lib/rollover.ts`, `lib/routines.ts`, or any other scheduling logic.
- No bulk/batch API endpoint — migration uploads one task at a time (per the backend spec's non-goals).

---

## Task 1: Field mapping + server-side task API client

**Files:**
- Create: `frontend/src/features/tasks/api/mapping.ts`
- Create: `frontend/src/features/tasks/api/mapping.test.ts`
- Create: `frontend/src/features/tasks/api/tasks.ts`
- Create: `frontend/src/features/tasks/api/tasks.test.ts`

**Interfaces:**
- Consumes: `Task`/`Scope` types (`../types.ts`); `getAccessToken` (`@/lib/auth/cookies`, already exists).
- Produces: `toApiPayload(task: Task): ApiTask`, `fromApiPayload(payload: ApiTask): Task` (mapping.ts); `requestListTasks(): Promise<Task[]>`, `requestCreateTask(task: Task): Promise<{ status: number; task?: Task; duplicateId: boolean }>`, `requestUpdateTask(task: Task): Promise<Task>`, `requestDeleteTask(id: string): Promise<void>` (tasks.ts). Consumed by Task 2's route handlers.

- [ ] **Step 1: Write the failing mapping tests**

  Create `frontend/src/features/tasks/api/mapping.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
  import type { Task } from "../types";

  const fullApiTask: ApiTask = {
    id: "a1",
    title: "write plan",
    memo: "details",
    done: true,
    scope_kind: "day",
    scope_value: "2026-07-27",
    rolled_from_kind: "day",
    rolled_from_value: "2026-07-20",
    created_at: "2026-07-27T00:00:00.000Z",
    completed_at: "2026-07-27T09:00:00.000Z",
    time: "09:30",
    due_date: "2026-08-01",
    subtasks: [{ id: "s1", title: "buy wood", done: false }],
    repeat_weekdays: [1, 3, 5],
    repeat_source: "anchor-1",
    excluded_dates: ["2026-07-13"],
    priority: true,
    duration_minutes: 45,
    background: true,
  };

  const fullTask: Task = {
    id: "a1",
    title: "write plan",
    memo: "details",
    done: true,
    scope: { kind: "day", date: "2026-07-27" },
    rolledFrom: { kind: "day", date: "2026-07-20" },
    createdAt: "2026-07-27T00:00:00.000Z",
    completedAt: "2026-07-27T09:00:00.000Z",
    time: "09:30",
    dueDate: "2026-08-01",
    subtasks: [{ id: "s1", title: "buy wood", done: false }],
    repeatWeekdays: [1, 3, 5],
    repeatSourceId: "anchor-1",
    excludedDates: ["2026-07-13"],
    priority: true,
    durationMinutes: 45,
    background: true,
  };

  describe("fromApiPayload", () => {
    it("maps every field from a fully-populated ApiTask", () => {
      expect(fromApiPayload(fullApiTask)).toEqual(fullTask);
    });

    it("maps nulls to undefined for optional fields, and omits rolledFrom when either half is null", () => {
      const minimal: ApiTask = {
        id: "b1",
        title: "solo",
        memo: null,
        done: false,
        scope_kind: "week",
        scope_value: "2026-07-19",
        rolled_from_kind: null,
        rolled_from_value: null,
        created_at: "2026-07-27T00:00:00.000Z",
        completed_at: null,
        time: null,
        due_date: null,
        subtasks: [],
        repeat_weekdays: null,
        repeat_source: null,
        excluded_dates: null,
        priority: null,
        duration_minutes: null,
        background: null,
      };

      const task = fromApiPayload(minimal);

      expect(task.memo).toBeUndefined();
      expect(task.rolledFrom).toBeUndefined();
      expect(task.time).toBeUndefined();
      expect(task.dueDate).toBeUndefined();
      expect(task.repeatWeekdays).toBeUndefined();
      expect(task.repeatSourceId).toBeUndefined();
      expect(task.excludedDates).toBeUndefined();
      expect(task.priority).toBeUndefined();
      expect(task.durationMinutes).toBeUndefined();
      expect(task.background).toBeUndefined();
      expect(task.scope).toEqual({ kind: "week", weekStart: "2026-07-19" });
    });
  });

  describe("toApiPayload", () => {
    it("maps every field from a fully-populated Task", () => {
      expect(toApiPayload(fullTask)).toEqual(fullApiTask);
    });

    it("maps undefined to null for optional fields, and both rolled_from_* to null when rolledFrom is unset", () => {
      const minimal: Task = {
        id: "b1",
        title: "solo",
        done: false,
        scope: { kind: "month", month: "2026-07" },
        createdAt: "2026-07-27T00:00:00.000Z",
      };

      const payload = toApiPayload(minimal);

      expect(payload.memo).toBeNull();
      expect(payload.rolled_from_kind).toBeNull();
      expect(payload.rolled_from_value).toBeNull();
      expect(payload.time).toBeNull();
      expect(payload.due_date).toBeNull();
      expect(payload.subtasks).toEqual([]);
      expect(payload.repeat_weekdays).toBeNull();
      expect(payload.repeat_source).toBeNull();
      expect(payload.excluded_dates).toBeNull();
      expect(payload.priority).toBeNull();
      expect(payload.duration_minutes).toBeNull();
      expect(payload.background).toBeNull();
      expect(payload.scope_kind).toBe("month");
      expect(payload.scope_value).toBe("2026-07");
    });

    it("round-trips a year-scoped task", () => {
      const yearTask: Task = {
        id: "c1",
        title: "yearly review",
        done: false,
        scope: { kind: "year", year: "2026" },
        createdAt: "2026-07-27T00:00:00.000Z",
      };

      expect(fromApiPayload(toApiPayload(yearTask))).toEqual(yearTask);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/api/mapping.test.ts`
  Expected: FAIL — `mapping.ts` doesn't exist yet.

- [ ] **Step 3: Implement the mapping module**

  Create `frontend/src/features/tasks/api/mapping.ts`:

  ```ts
  import type { Scope, Subtask, Task } from "../types";

  type ScopeKind = Scope["kind"];

  export interface ApiTask {
    id: string;
    title: string;
    memo: string | null;
    done: boolean;
    scope_kind: ScopeKind;
    scope_value: string;
    rolled_from_kind: ScopeKind | null;
    rolled_from_value: string | null;
    created_at: string;
    completed_at: string | null;
    time: string | null;
    due_date: string | null;
    subtasks: Subtask[];
    repeat_weekdays: number[] | null;
    repeat_source: string | null;
    excluded_dates: string[] | null;
    priority: boolean | null;
    duration_minutes: number | null;
    background: boolean | null;
  }

  function scopeValueOf(scope: Scope): string {
    switch (scope.kind) {
      case "day":
        return scope.date;
      case "week":
        return scope.weekStart;
      case "month":
        return scope.month;
      case "year":
        return scope.year;
    }
  }

  function scopeFromParts(kind: ScopeKind, value: string): Scope {
    switch (kind) {
      case "day":
        return { kind: "day", date: value };
      case "week":
        return { kind: "week", weekStart: value };
      case "month":
        return { kind: "month", month: value };
      case "year":
        return { kind: "year", year: value };
    }
  }

  export function toApiPayload(task: Task): ApiTask {
    return {
      id: task.id,
      title: task.title,
      memo: task.memo ?? null,
      done: task.done,
      scope_kind: task.scope.kind,
      scope_value: scopeValueOf(task.scope),
      rolled_from_kind: task.rolledFrom?.kind ?? null,
      rolled_from_value: task.rolledFrom ? scopeValueOf(task.rolledFrom) : null,
      created_at: task.createdAt,
      completed_at: task.completedAt ?? null,
      time: task.time ?? null,
      due_date: task.dueDate ?? null,
      subtasks: task.subtasks ?? [],
      repeat_weekdays: task.repeatWeekdays ?? null,
      repeat_source: task.repeatSourceId ?? null,
      excluded_dates: task.excludedDates ?? null,
      priority: task.priority ?? null,
      duration_minutes: task.durationMinutes ?? null,
      background: task.background ?? null,
    };
  }

  export function fromApiPayload(payload: ApiTask): Task {
    return {
      id: payload.id,
      title: payload.title,
      memo: payload.memo ?? undefined,
      done: payload.done,
      scope: scopeFromParts(payload.scope_kind, payload.scope_value),
      rolledFrom:
        payload.rolled_from_kind && payload.rolled_from_value
          ? scopeFromParts(payload.rolled_from_kind, payload.rolled_from_value)
          : undefined,
      createdAt: payload.created_at,
      completedAt: payload.completed_at ?? undefined,
      time: payload.time ?? undefined,
      subtasks: payload.subtasks.length > 0 ? payload.subtasks : undefined,
      repeatWeekdays: payload.repeat_weekdays ?? undefined,
      repeatSourceId: payload.repeat_source ?? undefined,
      excludedDates: payload.excluded_dates ?? undefined,
      priority: payload.priority ?? undefined,
      durationMinutes: payload.duration_minutes ?? undefined,
      background: payload.background ?? undefined,
      dueDate: payload.due_date ?? undefined,
    };
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run src/features/tasks/api/mapping.test.ts`
  Expected: PASS

- [ ] **Step 5: Write the failing API-client tests**

  Create `frontend/src/features/tasks/api/tasks.test.ts`:

  ```ts
  import { afterEach, describe, expect, it, vi } from "vitest";

  vi.mock("@/lib/auth/cookies", () => ({
    getAccessToken: vi.fn().mockResolvedValue("test-token"),
  }));

  import type { ApiTask } from "./mapping";
  import { requestCreateTask, requestDeleteTask, requestListTasks, requestUpdateTask } from "./tasks";
  import type { Task } from "../types";

  const apiTask: ApiTask = {
    id: "a1",
    title: "write plan",
    memo: null,
    done: false,
    scope_kind: "day",
    scope_value: "2026-07-27",
    rolled_from_kind: null,
    rolled_from_value: null,
    created_at: "2026-07-27T00:00:00.000Z",
    completed_at: null,
    time: null,
    due_date: null,
    subtasks: [],
    repeat_weekdays: null,
    repeat_source: null,
    excluded_dates: null,
    priority: null,
    duration_minutes: null,
    background: null,
  };

  const task: Task = {
    id: "a1",
    title: "write plan",
    done: false,
    scope: { kind: "day", date: "2026-07-27" },
    createdAt: "2026-07-27T00:00:00.000Z",
  };

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("requestListTasks", () => {
    it("fetches and maps the list, attaching the access token", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse([apiTask]));
      vi.stubGlobal("fetch", fetchSpy);

      const tasks = await requestListTasks();

      expect(tasks).toEqual([task]);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/api/tasks/");
      expect((init.headers as Headers).get("Authorization")).toBe("Bearer test-token");
    });

    it("throws when the response is not ok", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "nope" }, 500)));
      await expect(requestListTasks()).rejects.toThrow();
    });
  });

  describe("requestCreateTask", () => {
    it("posts the mapped payload and returns the mapped result on success", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(apiTask, 201));
      vi.stubGlobal("fetch", fetchSpy);

      const result = await requestCreateTask(task);

      expect(result).toEqual({ status: 201, task, duplicateId: false });
      const [, init] = fetchSpy.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({ id: "a1", scope_kind: "day" });
    });

    it("flags a duplicate-id 400 without a task", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ id: ["A task with this id already exists."] }, 400)),
      );

      const result = await requestCreateTask(task);

      expect(result).toEqual({ status: 400, task: undefined, duplicateId: true });
    });

    it("does not flag an unrelated 400 as a duplicate id", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ title: ["This field is required."] }, 400)),
      );

      const result = await requestCreateTask(task);

      expect(result).toEqual({ status: 400, task: undefined, duplicateId: false });
    });
  });

  describe("requestUpdateTask", () => {
    it("puts the mapped payload to the task's own url and returns the mapped result", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(apiTask));
      vi.stubGlobal("fetch", fetchSpy);

      const result = await requestUpdateTask(task);

      expect(result).toEqual(task);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/api/tasks/a1/");
      expect(init.method).toBe("PUT");
    });

    it("throws when the response is not ok", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 400)));
      await expect(requestUpdateTask(task)).rejects.toThrow();
    });
  });

  describe("requestDeleteTask", () => {
    it("deletes at the id's url", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null, 204));
      vi.stubGlobal("fetch", fetchSpy);

      await requestDeleteTask("a1");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/api/tasks/a1/");
      expect(init.method).toBe("DELETE");
    });

    it("throws when the response is not ok", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));
      await expect(requestDeleteTask("a1")).rejects.toThrow();
    });
  });
  ```

- [ ] **Step 6: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/api/tasks.test.ts`
  Expected: FAIL — `tasks.ts` doesn't exist yet.

- [ ] **Step 7: Implement the server-side API client**

  Create `frontend/src/features/tasks/api/tasks.ts`:

  ```ts
  import { getAccessToken } from "@/lib/auth/cookies";

  import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
  import type { Task } from "../types";

  const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

  async function djangoFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await getAccessToken();
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    return fetch(`${API_BASE_URL}/api/tasks${path}`, { ...init, headers, cache: "no-store" });
  }

  function isDuplicateIdError(body: unknown): boolean {
    const idErrors = (body as { id?: unknown } | null)?.id;
    return (
      Array.isArray(idErrors) &&
      idErrors.some((message) => typeof message === "string" && message.includes("already exists"))
    );
  }

  export async function requestListTasks(): Promise<Task[]> {
    const response = await djangoFetch("/");
    if (!response.ok) throw new Error("Failed to load tasks.");
    const payloads: ApiTask[] = await response.json();
    return payloads.map(fromApiPayload);
  }

  export async function requestCreateTask(
    task: Task,
  ): Promise<{ status: number; task?: Task; duplicateId: boolean }> {
    const response = await djangoFetch("/", {
      method: "POST",
      body: JSON.stringify(toApiPayload(task)),
    });
    if (response.ok) {
      return { status: response.status, task: fromApiPayload(await response.json()), duplicateId: false };
    }
    const body: unknown = response.status === 400 ? await response.json().catch(() => null) : null;
    return { status: response.status, duplicateId: response.status === 400 && isDuplicateIdError(body) };
  }

  export async function requestUpdateTask(task: Task): Promise<Task> {
    const response = await djangoFetch(`/${task.id}/`, {
      method: "PUT",
      body: JSON.stringify(toApiPayload(task)),
    });
    if (!response.ok) throw new Error("Failed to save task.");
    return fromApiPayload(await response.json());
  }

  export async function requestDeleteTask(id: string): Promise<void> {
    const response = await djangoFetch(`/${id}/`, { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to delete task.");
  }
  ```

- [ ] **Step 8: Run the tests to verify they pass**

  Run: `npx vitest run src/features/tasks/api/tasks.test.ts`
  Expected: PASS

- [ ] **Step 9: Commit**

  ```bash
  git add src/features/tasks/api/mapping.ts src/features/tasks/api/mapping.test.ts src/features/tasks/api/tasks.ts src/features/tasks/api/tasks.test.ts
  git commit -m "feat: add task API field mapping and server-side request client"
  ```

---

## Task 2: Route handlers + client-side API-backed repository with migration

**Files:**
- Create: `frontend/src/app/api/tasks/route.ts`
- Create: `frontend/src/app/api/tasks/[id]/route.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts` (export `STORAGE_KEY`)
- Create: `frontend/src/features/tasks/data/api-task-repository.ts`
- Create: `frontend/src/features/tasks/data/api-task-repository.test.ts`

**Interfaces:**
- Consumes: `requestListTasks`/`requestCreateTask`/`requestUpdateTask`/`requestDeleteTask` (Task 1); `TaskRepository` interface and `createLocalStorageRepository` (`./repository`, already exists).
- Produces: `createApiTaskRepository(): TaskRepository`, exported from `data/api-task-repository.ts`. Consumed by Task 3 (`store.tsx`'s default repository).

- [ ] **Step 1: Export `STORAGE_KEY` from the existing local-storage repository**

  In `frontend/src/features/tasks/data/repository.ts`, change:

  ```ts
  const STORAGE_KEY = "picking-up.tasks.v1";
  ```

  to:

  ```ts
  export const STORAGE_KEY = "picking-up.tasks.v1";
  ```

  This is the only change to this file — everything else about the
  local-storage repository is untouched (it stays available as a
  fallback and as the migration's data source).

- [ ] **Step 2: Write the route handlers (no tests — see Global Constraints)**

  Create `frontend/src/app/api/tasks/route.ts`:

  ```ts
  import { NextResponse, type NextRequest } from "next/server";

  import { requestCreateTask, requestListTasks } from "@/features/tasks/api/tasks";

  export async function GET() {
    try {
      const tasks = await requestListTasks();
      return NextResponse.json(tasks);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to load tasks." },
        { status: 502 },
      );
    }
  }

  export async function POST(request: NextRequest) {
    const task = await request.json();
    const result = await requestCreateTask(task);
    if (result.task) {
      return NextResponse.json(result.task, { status: 201 });
    }
    return NextResponse.json(
      { error: "Failed to save task." },
      { status: result.duplicateId ? 409 : 400 },
    );
  }
  ```

  Create `frontend/src/app/api/tasks/[id]/route.ts`:

  ```ts
  import { NextResponse, type NextRequest } from "next/server";

  import { requestDeleteTask, requestUpdateTask } from "@/features/tasks/api/tasks";

  export async function PUT(request: NextRequest) {
    try {
      const task = await request.json();
      const updated = await requestUpdateTask(task);
      return NextResponse.json(updated);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to save task." },
        { status: 400 },
      );
    }
  }

  export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
      await requestDeleteTask(id);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to delete task." },
        { status: 400 },
      );
    }
  }
  ```

  Note `PUT` doesn't need `params` at all — the task's own `id` field in
  the request body is what `requestUpdateTask` uses to build the Django
  URL; the `[id]` URL segment exists only for REST-conventional routing
  and DELETE's use of it.

- [ ] **Step 3: Write the failing repository tests**

  `vitest.setup.ts` already provides a real, working jsdom `localStorage`
  and clears it in a global `afterEach` — there's no existing convention
  anywhere in this codebase for stubbing `localStorage` with a fake, so
  these tests use the real thing directly (matching that existing setup)
  rather than introducing a new stubbing pattern.

  Create `frontend/src/features/tasks/data/api-task-repository.test.ts`:

  ```ts
  import { afterEach, describe, expect, it, vi } from "vitest";

  import { createApiTaskRepository } from "./api-task-repository";
  import { STORAGE_KEY } from "./repository";
  import { makeTask } from "../test-utils";

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  describe("createApiTaskRepository", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("list() fetches the server list directly when localStorage has nothing to migrate", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal("fetch", fetchSpy);

      const tasks = await createApiTaskRepository().list();

      expect(tasks).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/");
    });

    it("list() uploads every local task once, then clears localStorage, when there's something to migrate", async () => {
      const local = [makeTask({ id: "a" }), makeTask({ id: "b" })];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: "a" }, 201)) // upload a
        .mockResolvedValueOnce(jsonResponse({ id: "b" }, 201)) // upload b
        .mockResolvedValueOnce(jsonResponse(local)); // final list()
      vi.stubGlobal("fetch", fetchSpy);

      const tasks = await createApiTaskRepository().list();

      expect(tasks).toEqual(local);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST" });
      expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: "POST" });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("list() tolerates a 409 (already migrated) for a task and still clears localStorage", async () => {
      const local = [makeTask({ id: "a" })];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "Failed to save task." }, 409))
        .mockResolvedValueOnce(jsonResponse(local));
      vi.stubGlobal("fetch", fetchSpy);

      const tasks = await createApiTaskRepository().list();

      expect(tasks).toEqual(local);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("list() leaves localStorage intact and throws when a real upload failure occurs", async () => {
      const local = [makeTask({ id: "a" }), makeTask({ id: "b" })];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500)); // fails on task a
      vi.stubGlobal("fetch", fetchSpy);

      await expect(createApiTaskRepository().list()).rejects.toThrow();
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1); // stopped after the first failure, never reached b
    });

    it("create() posts to /api/tasks/ and throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 400)));
      await expect(createApiTaskRepository().create(makeTask())).rejects.toThrow();
    });

    it("update() puts to the task's own url and throws on failure", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}, 200));
      vi.stubGlobal("fetch", fetchSpy);
      const task = makeTask({ id: "x" });

      await createApiTaskRepository().update(task);

      expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/x/", expect.objectContaining({ method: "PUT" }));
    });

    it("remove() deletes at the id's url and throws on failure", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null, 204));
      vi.stubGlobal("fetch", fetchSpy);

      await createApiTaskRepository().remove("x");

      expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/x/", expect.objectContaining({ method: "DELETE" }));
    });
  });
  ```

  Note that `vitest.setup.ts`'s global `afterEach` clears `localStorage`
  automatically, so no explicit cleanup of the seeded key is needed
  inside this file's own tests.

- [ ] **Step 4: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/data/api-task-repository.test.ts`
  Expected: FAIL — `api-task-repository.ts` doesn't exist yet.

- [ ] **Step 5: Implement the client-side repository**

  Create `frontend/src/features/tasks/data/api-task-repository.ts`:

  ```ts
  import type { Task } from "../types";
  import { createLocalStorageRepository, STORAGE_KEY, type TaskRepository } from "./repository";

  async function parseJsonOrUndefined<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204) return undefined;
    return response.json();
  }

  async function uploadForMigration(task: Task): Promise<void> {
    const response = await fetch("/api/tasks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    if (response.ok || response.status === 409) return;
    throw new Error(`Failed to migrate task ${task.id}.`);
  }

  async function migrateLegacyLocalStorageTasks(): Promise<void> {
    const legacyTasks = await createLocalStorageRepository().list();
    if (legacyTasks.length === 0) return;
    for (const task of legacyTasks) {
      await uploadForMigration(task);
    }
    window.localStorage.removeItem(STORAGE_KEY);
  }

  export function createApiTaskRepository(): TaskRepository {
    return {
      async list() {
        await migrateLegacyLocalStorageTasks();
        const response = await fetch("/api/tasks/");
        if (!response.ok) throw new Error("Failed to load tasks.");
        return (await response.json()) as Task[];
      },
      async create(task) {
        const response = await fetch("/api/tasks/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(task),
        });
        if (!response.ok) throw new Error("Failed to save task.");
      },
      async update(task) {
        const response = await fetch(`/api/tasks/${task.id}/`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(task),
        });
        if (!response.ok) throw new Error("Failed to save task.");
      },
      async remove(id) {
        const response = await fetch(`/api/tasks/${id}/`, { method: "DELETE" });
        if (!response.ok) throw new Error("Failed to delete task.");
        await parseJsonOrUndefined(response);
      },
    };
  }
  ```

  `parseJsonOrUndefined` is a small defensive no-op for `remove` (204
  responses have no body); it isn't load-bearing but keeps the shape
  consistent — if it feels unnecessary once written, it's fine to drop
  and just not read the body at all for `remove`, since nothing uses it.

- [ ] **Step 6: Run the tests to verify they pass**

  Run: `npx vitest run src/features/tasks/data/api-task-repository.test.ts`
  Expected: PASS

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/api/tasks/route.ts "src/app/api/tasks/[id]/route.ts" src/features/tasks/data/repository.ts src/features/tasks/data/api-task-repository.ts src/features/tasks/data/api-task-repository.test.ts
  git commit -m "feat: add task API route handlers and client-side repository with migration"
  ```

---

## Task 3: Wire error handling into the store, add the error banner, switch the default repository

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-calendar.tsx`
- Modify: `frontend/src/features/tasks/components/task-calendar.test.tsx`

**Interfaces:**
- Consumes: `createApiTaskRepository` (Task 2).
- Produces: `TasksState.syncError: string | null`; `TasksContextValue.dismissSyncError(): void`; `TaskCalendar` gains an optional `repository?: TaskRepository` prop (threaded straight to its internal `TasksProvider`, default `undefined`). `TasksProvider`'s own default repository (when no `repository` prop reaches *it*) becomes `createApiTaskRepository()` instead of `createLocalStorageRepository()` — every test that already passes an explicit `repository` prop to `TasksProvider` directly is unaffected; the one exception (`task-calendar.test.tsx`, which renders `<TaskCalendar />` with no override) is fixed in Step 3 before Step 4 flips the default.

- [ ] **Step 1: Write the failing store tests**

  In `frontend/src/features/tasks/store.test.tsx`, add a new `describe`
  block (after the existing `describe("background action", ...)` block,
  before the closing of the outer `describe("TasksProvider", ...)`):

  ```tsx
  describe("sync failure handling", () => {
    it("setMemo: on a repo.update rejection, sets syncError and resyncs tasks from a fresh list()", async () => {
      const task = makeTask({ id: "a", memo: "old" });
      const repo = fakeRepository([task]);
      const updateSpy = vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("network down"));
      const { result } = setup(repo);
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setMemo("a", "new"));
      await waitFor(() => expect(result.current.syncError).not.toBeNull());

      // resynced from the server, which never actually received the update
      await waitFor(() => expect(result.current.tasks[0].memo).toBe("old"));
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it("dismissSyncError clears the error without touching tasks", async () => {
      const task = makeTask({ id: "a" });
      const repo = fakeRepository([task]);
      vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("network down"));
      const { result } = setup(repo);
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setPriority("a", true));
      await waitFor(() => expect(result.current.syncError).not.toBeNull());

      act(() => result.current.dismissSyncError());
      expect(result.current.syncError).toBeNull();
    });

    it("initial list() rejection sets syncError and still reaches loaded:true with an empty list", async () => {
      const repo = fakeRepository();
      vi.spyOn(repo, "list").mockRejectedValueOnce(new Error("offline"));

      const { result } = setup(repo);

      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.tasks).toEqual([]);
      expect(result.current.syncError).not.toBeNull();
    });
  });
  ```

  This relies on `fakeRepository`'s methods being spy-able with
  `vi.spyOn` — check `frontend/src/features/tasks/test-utils.tsx` first;
  if `fakeRepository`'s returned object methods aren't plain assignable
  functions on a plain object (they should be, per its current
  implementation), `vi.spyOn(repo, "update")` works as-is with no
  changes needed there.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/features/tasks/store.test.tsx`
  Expected: FAIL — `syncError`/`dismissSyncError` don't exist yet.

- [ ] **Step 3: Thread a `repository` override through `TaskCalendar`, before touching the default**

  This step must land *before* Step 4 flips `TasksProvider`'s default
  repository. `TaskCalendar` (`frontend/src/features/tasks/components/task-calendar.tsx`)
  currently hardcodes `<TasksProvider>` with no way to override the
  repository — and its own test file,
  `frontend/src/features/tasks/components/task-calendar.test.tsx`,
  renders `<TaskCalendar />` bare in all 4 of its existing tests,
  implicitly relying on whatever `TasksProvider`'s default repository
  happens to be. Every *other* test file that touches `TasksProvider`
  already passes an explicit `repository={fakeRepository(...)}` (verified
  by checking every call site) — this file is the one exception. Once
  the default becomes `createApiTaskRepository()`, those 4 tests would
  start issuing real `fetch()` calls in jsdom and fail outright, so fix
  this first while the default is still the harmless local-storage one.

  In `frontend/src/features/tasks/components/task-calendar.tsx`, add the
  import (alongside the existing ones):

  ```tsx
  import type { TaskRepository } from "../data/repository";
  ```

  Change:

  ```tsx
  export function TaskCalendar() {
    return (
      <TasksProvider>
        <CalendarInner />
      </TasksProvider>
    );
  }
  ```

  to:

  ```tsx
  export function TaskCalendar({ repository }: { repository?: TaskRepository } = {}) {
    return (
      <TasksProvider repository={repository}>
        <CalendarInner />
      </TasksProvider>
    );
  }
  ```

  In `frontend/src/features/tasks/components/task-calendar.test.tsx`, add
  `fakeRepository` to the existing import from `../test-utils` (add the
  import line if it isn't already there — currently this file only
  imports `shiftAnchor, TaskCalendar` from `./task-calendar`), then change
  each of the 4 existing `render(<TaskCalendar />)` calls (one at line 26,
  one at line 48, one at line 76, one at line 88) to
  `render(<TaskCalendar repository={fakeRepository()} />)`. None of these
  4 tests assert anything about specific seeded tasks, so an empty
  `fakeRepository()` is correct for all of them — don't seed tasks that
  aren't asserted on.

  Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
  Expected: PASS — the default repository hasn't changed yet at this
  point in the plan, so this step is a purely additive, behavior-neutral
  prep change; if anything fails here, stop and fix it before proceeding,
  rather than letting it compound with Step 4's default-repository swap.

- [ ] **Step 4: Rewrite `store.tsx`**

  Replace the entire contents of `frontend/src/features/tasks/store.tsx`
  with:

  ```tsx
  "use client";

  import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    type ReactNode,
  } from "react";

  import { createApiTaskRepository } from "./data/api-task-repository";
  import type { TaskRepository } from "./data/repository";
  import { todayKey } from "./lib/dates";
  import { isValidTime } from "./lib/times";
  import { rolloverTasks } from "./lib/rollover";
  import { materializeRoutines } from "./lib/routines";
  import type { Scope, Task } from "./types";

  const SYNC_ERROR_MESSAGE = "Something didn't save. Reconnecting to check what's saved…";

  export interface TasksState {
    loaded: boolean;
    tasks: Task[];
    syncError: string | null;
  }

  export type TasksAction =
    | { type: "loaded"; tasks: Task[] }
    | { type: "added"; task: Task }
    | { type: "updated"; task: Task }
    | { type: "removed"; id: string }
    | { type: "syncErrorOccurred" }
    | { type: "syncErrorDismissed" };

  export function tasksReducer(
    state: TasksState,
    action: TasksAction,
  ): TasksState {
    switch (action.type) {
      case "loaded":
        return { ...state, loaded: true, tasks: action.tasks };
      case "added":
        return { ...state, tasks: [...state.tasks, action.task] };
      case "updated":
        return {
          ...state,
          tasks: state.tasks.map((t) =>
            t.id === action.task.id ? action.task : t,
          ),
        };
      case "removed":
        return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
      case "syncErrorOccurred":
        return { ...state, syncError: SYNC_ERROR_MESSAGE };
      case "syncErrorDismissed":
        return { ...state, syncError: null };
    }
  }

  interface TasksContextValue extends TasksState {
    addTask: (title: string, scope: Scope) => Task | undefined;
    toggleTask: (id: string) => void;
    setMemo: (id: string, memo: string) => void;
    setTime: (id: string, time: string | undefined) => void;
    setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
    detachFromRoutine: (id: string, weekdays?: number[]) => void;
    setPriority: (id: string, priority: boolean) => void;
    setDuration: (id: string, durationMinutes: number | undefined) => void;
    setBackground: (id: string, background: boolean) => void;
    setDueDate: (id: string, dueDate: string | undefined) => void;
    removeTask: (id: string) => void;
    addSubtask: (id: string, title: string) => void;
    toggleSubtask: (id: string, subtaskId: string) => void;
    removeSubtask: (id: string, subtaskId: string) => void;
    dismissSyncError: () => void;
  }

  const TasksContext = createContext<TasksContextValue | null>(null);

  export function TasksProvider({
    repository,
    children,
  }: {
    repository?: TaskRepository;
    children: ReactNode;
  }) {
    const [state, dispatch] = useReducer(tasksReducer, {
      loaded: false,
      tasks: [],
      syncError: null,
    });
    const repo = useMemo(
      () => repository ?? createApiTaskRepository(),
      [repository],
    );

    function handleSyncFailure() {
      dispatch({ type: "syncErrorOccurred" });
      void repo
        .list()
        .then((tasks) => dispatch({ type: "loaded", tasks }))
        .catch(() => {
          // Already surfaced via syncErrorOccurred above; a second
          // consecutive failure just leaves the banner up rather than
          // compounding into an unhandled rejection.
        });
    }

    const tasksRef = useRef(state.tasks);
    tasksRef.current = state.tasks;
    const appliedDayRef = useRef<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      void repo
        .list()
        .then((tasks) => {
          if (cancelled) return;
          const today = todayKey();
          const rolled = rolloverTasks(tasks, today);
          const spawned = materializeRoutines(rolled, today);
          const finalTasks = [...rolled, ...spawned];
          dispatch({ type: "loaded", tasks: finalTasks });
          appliedDayRef.current = today;
          rolled.forEach((task, i) => {
            if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
          });
          spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
        })
        .catch(() => {
          if (cancelled) return;
          dispatch({ type: "syncErrorOccurred" });
          dispatch({ type: "loaded", tasks: [] });
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo]);

    useEffect(() => {
      function rolloverIfDateChanged() {
        if (appliedDayRef.current === null) return;
        const today = todayKey();
        if (today === appliedDayRef.current) return;
        const tasks = tasksRef.current;
        const rolled = rolloverTasks(tasks, today);
        const spawned = materializeRoutines(rolled, today);
        const finalTasks = [...rolled, ...spawned];
        dispatch({ type: "loaded", tasks: finalTasks });
        appliedDayRef.current = today;
        rolled.forEach((task, i) => {
          if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
        });
        spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
      }

      window.addEventListener("focus", rolloverIfDateChanged);
      document.addEventListener("visibilitychange", rolloverIfDateChanged);
      return () => {
        window.removeEventListener("focus", rolloverIfDateChanged);
        document.removeEventListener("visibilitychange", rolloverIfDateChanged);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo]);

    const value = useMemo<TasksContextValue>(
      () => ({
        ...state,
        addTask(title, scope) {
          const trimmed = title.trim();
          if (!trimmed) return undefined;
          const task: Task = {
            id: crypto.randomUUID(),
            title: trimmed,
            done: false,
            scope,
            createdAt: new Date().toISOString(),
          };
          dispatch({ type: "added", task });
          repo.create(task).catch(handleSyncFailure);
          return task;
        },
        toggleTask(id) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = {
            ...current,
            done: !current.done,
            completedAt: current.done ? undefined : new Date().toISOString(),
          };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setMemo(id, memo) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = { ...current, memo: memo.trim() || undefined };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setTime(id, time) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          if (time !== undefined && !isValidTime(time)) return;
          const task: Task = { ...current, time };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setRepeatWeekdays(id, weekdays) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
          const task: Task = {
            ...current,
            repeatWeekdays: normalized,
            dueDate: normalized ? undefined : current.dueDate,
          };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        detachFromRoutine(id, weekdays) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
          const task: Task = { ...current, repeatSourceId: undefined, repeatWeekdays: normalized };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);

          if (current.repeatSourceId !== undefined && current.scope.kind === "day") {
            const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
            if (anchor) {
              const excludedDates = [...(anchor.excludedDates ?? []), current.scope.date];
              const updatedAnchor: Task = { ...anchor, excludedDates };
              dispatch({ type: "updated", task: updatedAnchor });
              repo.update(updatedAnchor).catch(handleSyncFailure);
            }
          }
        },
        setPriority(id, priority) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = { ...current, priority };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setDuration(id, durationMinutes) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = { ...current, durationMinutes };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setBackground(id, background) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = { ...current, background };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        setDueDate(id, dueDate) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const task: Task = { ...current, dueDate };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        addSubtask(id, title) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current) return;
          const trimmed = title.trim();
          if (!trimmed) return;
          const task: Task = {
            ...current,
            subtasks: [
              ...(current.subtasks ?? []),
              { id: crypto.randomUUID(), title: trimmed, done: false },
            ],
          };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        toggleSubtask(id, subtaskId) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current?.subtasks) return;
          const task: Task = {
            ...current,
            subtasks: current.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, done: !s.done } : s,
            ),
          };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        removeSubtask(id, subtaskId) {
          const current = state.tasks.find((t) => t.id === id);
          if (!current?.subtasks) return;
          const task: Task = {
            ...current,
            subtasks: current.subtasks.filter((s) => s.id !== subtaskId),
          };
          dispatch({ type: "updated", task });
          repo.update(task).catch(handleSyncFailure);
        },
        removeTask(id) {
          dispatch({ type: "removed", id });
          repo.remove(id).catch(handleSyncFailure);
        },
        dismissSyncError() {
          dispatch({ type: "syncErrorDismissed" });
        },
      }),
      [state, repo],
    );

    return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
  }

  export function useTasks(): TasksContextValue {
    const context = useContext(TasksContext);
    if (!context) throw new Error("useTasks must be used within TasksProvider");
    return context;
  }
  ```

  Every previous `void repo.X(...)` call is now `repo.X(...).catch(handleSyncFailure)`
  — confirm this by diffing against the original file; there should be
  no remaining `void repo.` anywhere in this file.

- [ ] **Step 5: Run the store tests to verify they pass**

  Run: `npx vitest run src/features/tasks/store.test.tsx`
  Expected: PASS, all tests (existing and new).

- [ ] **Step 6: Add the error banner to `TaskCalendar`**

  `frontend/src/features/tasks/components/task-calendar.test.tsx`
  already exists (confirmed while writing this plan) and currently
  imports only `shiftAnchor, TaskCalendar` from `./task-calendar`. Add
  `todayKey` to its existing import from `../lib/dates` (it doesn't
  import that module yet — add the import line), and add
  `fakeRepository, makeTask` from `../test-utils` (also not yet
  imported — add that import line too; both are needed since Step 3
  already added a `fakeRepository()` call to this file for the other 4
  tests, so `fakeRepository` may already be imported by the time you
  reach this step — check first rather than double-importing). Add this
  test in a new `describe` block at the end of the file:

  ```tsx
  describe("sync error banner", () => {
    it("shows a dismissible error banner when a sync error occurs, and hides it on dismiss", async () => {
      const day = todayKey();
      const task = makeTask({ id: "a", scope: { kind: "day", date: day } });
      const repo = fakeRepository([task]);
      vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("down"));

      render(<TaskCalendar repository={repo} />);

      await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByRole("checkbox")[0]);

      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      fireEvent.click(screen.getByText("Dismiss"));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
  ```

  `TaskCalendar` renders with its `repository` prop passed straight
  through to its own internal `TasksProvider` (per Step 3) — don't wrap
  it in a second, redundant `<TasksProvider>` of your own. The task is
  scoped to `todayKey()` (not a hardcoded date) so it actually appears in
  the Daily view `TaskCalendar` defaults to; `getAllByRole("checkbox")`
  (not the singular form) tolerates however many checkboxes the view
  happens to render for one task (e.g. if it appears in more than one
  panel) — clicking the first one is enough to trigger `toggleTask`,
  which calls `repo.update`.

  If reality differs from this description once you run it (e.g. the
  seeded task doesn't render where expected, or a different query is
  needed to reach it), read a neighboring passing test in this same file
  for the actual convention rather than guessing further — but this
  should work as written.

  Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
  Expected: FAIL — no `role="alert"` element exists yet.

  In `frontend/src/features/tasks/components/task-calendar.tsx`, add the
  import:

  ```tsx
  import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
  ```

  Change `CalendarInner`'s destructure:

  ```tsx
  const { loaded } = useTasks();
  ```

  to:

  ```tsx
  const { loaded, syncError, dismissSyncError } = useTasks();
  ```

  Then, right after the closing `</header>` tag, before the
  `<div className="min-h-0 flex-1 overflow-hidden">` line, add:

  ```tsx
        {syncError && (
          <div className="shrink-0 px-10 pt-3">
            <Alert variant="destructive">
              <AlertTitle>{syncError}</AlertTitle>
              <AlertAction>
                <button
                  type="button"
                  onClick={dismissSyncError}
                  className="text-xs text-destructive/70 underline hover:text-destructive"
                >
                  Dismiss
                </button>
              </AlertAction>
            </Alert>
          </div>
        )}
  ```

  Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
  Expected: PASS

- [ ] **Step 7: Run the full frontend test suite**

  Run: `npx vitest run`
  Expected: PASS with zero failures — the flaky `ScopeTasks weekly rollup
  > excludes a day-scoped task dated excludeDate` test that used to be
  the one known pre-existing exception was removed entirely in PR #29
  (merged into `main` before this plan's work began). If that specific
  test name still appears and fails, this branch's merge-base predates
  PR #29 — merge/rebase onto current `main` first rather than treating
  it as expected.

- [ ] **Step 8: Commit**

  ```bash
  git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx src/features/tasks/components/task-calendar.tsx src/features/tasks/components/task-calendar.test.tsx
  git commit -m "feat: surface sync failures with a resync-and-error-banner, default to the API repository"
  ```

---

## Task 4: Manual verification against the running app and real backend

**Files:** none (no code changes)

- [ ] **Step 1: Start both servers**

  Backend (from `backend/`, using its venv):
  `.venv/Scripts/python.exe manage.py runserver 8000`

  Frontend (from `frontend/`), pointed at that backend:
  `DJANGO_API_BASE_URL=http://localhost:8000 npm run dev`

  (Confirm the exact env var name matches what `frontend/src/lib/api/server.ts`
  and the new `features/tasks/api/tasks.ts` both read —
  `DJANGO_API_BASE_URL` — and that `frontend/.env`/`.env.development`
  already sets `DJANGO_CORS_ALLOWED_ORIGINS` on the backend side to
  include the frontend's dev origin, or CORS will block every request;
  check `backend/.env.development` first.)

- [ ] **Step 2: Verify the plain sync path**

  Register a new account through the running app's `/signup` page, log
  in, and use the task app normally — add a task with a memo, a due
  date, a repeat schedule, and a subtask; toggle it done; edit it; delete
  it. After each action, refresh the page and confirm the change
  persisted (proves it's actually round-tripping through the API, not
  just updating in-memory state).

- [ ] **Step 3: Verify migration**

  In the browser's dev tools console, clear whatever the current account
  synced (`Application > Local Storage`, or just use a fresh
  browser profile), then manually seed localStorage with a legacy-shaped
  task list before the app's first load for a **new** test account:
  ```js
  localStorage.setItem("picking-up.tasks.v1", JSON.stringify([
    { id: crypto.randomUUID(), title: "legacy task", done: false,
      scope: { kind: "day", date: "2026-07-27" }, createdAt: new Date().toISOString() },
  ]));
  ```
  Register/log in as that new account, load `/app`, and confirm "legacy
  task" appears (migrated) and that `localStorage.getItem("picking-up.tasks.v1")`
  is now `null`. Reload again and confirm no duplicate appears.

- [ ] **Step 4: Verify the error banner**

  With the frontend still running, stop the backend server (or block
  its port) and try to toggle/edit a task in the already-loaded frontend
  tab. Confirm the error banner appears with a dismiss control, and that
  dismissing it clears the banner. Restart the backend and confirm a
  subsequent successful action works normally again.

- [ ] **Step 5: Stop both servers and report results**

  Note any discrepancies from Steps 2-4. If everything matched, this
  plan is complete.
