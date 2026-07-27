import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

import { NextRequest } from "next/server";

import { DELETE, PUT } from "@/app/api/tasks/[id]/route";
import { GET, POST } from "@/app/api/tasks/route";
import type { ApiTask } from "@/features/tasks/api/mapping";

import { createApiTaskRepository } from "./api-task-repository";
import type { Task } from "../types";

const DJANGO_ORIGIN = "http://localhost:8000";
const NEXT_ORIGIN = "http://localhost:3000";

const apiTask: ApiTask = {
  id: "a1",
  title: "write plan",
  memo: "with a memo",
  done: false,
  scope_kind: "day",
  scope_value: "2026-07-27",
  rolled_from_kind: "day",
  rolled_from_value: "2026-07-26",
  created_at: "2026-07-27T00:00:00.000Z",
  completed_at: null,
  time: "09:30",
  due_date: "2026-07-31",
  subtasks: [{ id: "s1", title: "one", done: false }],
  repeat_weekdays: [1, 3],
  repeat_source: null,
  excluded_dates: null,
  priority: true,
  duration_minutes: 45,
  background: null,
};

const expectedTask: Task = {
  id: "a1",
  title: "write plan",
  memo: "with a memo",
  done: false,
  scope: { kind: "day", date: "2026-07-27" },
  rolledFrom: { kind: "day", date: "2026-07-26" },
  createdAt: "2026-07-27T00:00:00.000Z",
  completedAt: undefined,
  time: "09:30",
  subtasks: [{ id: "s1", title: "one", done: false }],
  repeatWeekdays: [1, 3],
  repeatSourceId: undefined,
  excludedDates: undefined,
  priority: true,
  durationMinutes: 45,
  background: undefined,
  dueDate: "2026-07-31",
};

/** Requests the fake Django leg received, for asserting on the outbound side. */
interface DjangoCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/**
 * Everything below is real code except the Django leg: the client repository's
 * relative-path fetches are routed into this repo's *real* Route Handler
 * functions, which in turn call the real request/mapping layer, whose fetch
 * lands on the canned Django responses configured here.
 */
function installFetchRouter(django: (call: DjangoCall) => Response | Promise<Response>) {
  const calls: DjangoCall[] = [];

  async function router(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init.method ?? "GET").toUpperCase();

    if (url.startsWith(DJANGO_ORIGIN)) {
      const headers = new Headers(init.headers);
      const call: DjangoCall = {
        url,
        method,
        authorization: headers.get("Authorization"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      return django(call);
    }

    if (url.startsWith("/api/tasks")) {
      // Not a leg to intercept — this is the thing under test. Hand it to the
      // real Next.js Route Handler for this path.
      const request = new NextRequest(`${NEXT_ORIGIN}${url}`, {
        method,
        headers: new Headers(init.headers),
        ...(init.body ? { body: init.body as string } : {}),
      });
      const [, , , id] = url.split("/"); // "", "api", "tasks", maybe id
      if (!id) {
        return method === "POST" ? POST(request) : GET();
      }
      return method === "DELETE"
        ? DELETE(request, { params: Promise.resolve({ id }) })
        : PUT(request);
    }

    throw new Error(`Unexpected fetch to ${url}`);
  }

  const spy = vi.fn(router);
  vi.stubGlobal("fetch", spy);
  return { djangoCalls: calls };
}

describe("client repository -> real route handlers -> mapping (no mocked seams between them)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() returns camelCase Tasks mapped from Django's snake_case payload", async () => {
    const { djangoCalls } = installFetchRouter(() => Response.json([apiTask]));

    const tasks = await createApiTaskRepository().list();

    expect(tasks).toEqual([expectedTask]);
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/`);
    expect(djangoCalls[0].method).toBe("GET");
    expect(djangoCalls[0].authorization).toBe("Bearer test-token");
  });

  it("create() sends a snake_case payload through the real handler to Django", async () => {
    const { djangoCalls } = installFetchRouter(() => Response.json(apiTask, { status: 201 }));

    await createApiTaskRepository().create(expectedTask);

    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/`);
    expect(djangoCalls[0].method).toBe("POST");
    expect(djangoCalls[0].authorization).toBe("Bearer test-token");
    expect(djangoCalls[0].body).toMatchObject({
      id: "a1",
      scope_kind: "day",
      scope_value: "2026-07-27",
      due_date: "2026-07-31",
      duration_minutes: 45,
    });
  });

  it("update() PUTs to the trailing-slash Django url for the task's own id", async () => {
    const { djangoCalls } = installFetchRouter(() => Response.json(apiTask));

    await createApiTaskRepository().update(expectedTask);

    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/a1/`);
    expect(djangoCalls[0].method).toBe("PUT");
  });

  it("remove() drives the [id] route's async params through to Django's 204", async () => {
    const { djangoCalls } = installFetchRouter(() => new Response(null, { status: 204 }));

    await createApiTaskRepository().remove("a1");

    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/a1/`);
    expect(djangoCalls[0].method).toBe("DELETE");
  });

  it("a Django failure propagates through the real route handler as a rejected list()", async () => {
    installFetchRouter(() => Response.json({ detail: "token expired" }, { status: 401 }));

    await expect(createApiTaskRepository().list()).rejects.toThrow("Failed to load tasks.");
  });
});
