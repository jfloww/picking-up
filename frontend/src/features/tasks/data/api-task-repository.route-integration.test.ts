import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server-cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

import { NextRequest } from "next/server";

import { POST as DELETE_OCCURRENCE } from "@/app/api/tasks/[id]/commands/delete-occurrence/route";
import { POST as DETACH } from "@/app/api/tasks/[id]/commands/detach/route";
import { POST as NEST } from "@/app/api/tasks/[id]/commands/nest/route";
import { POST as PROMOTE_SUBTASK } from "@/app/api/tasks/[id]/commands/promote-subtask/route";
import { POST as REORDER } from "@/app/api/tasks/[id]/commands/reorder/route";
import { POST as RESCHEDULE } from "@/app/api/tasks/[id]/commands/reschedule/route";
import { DELETE, PUT } from "@/app/api/tasks/[id]/route";
import { GET, POST } from "@/app/api/tasks/route";
import type { ApiTask } from "@/features/tasks/api/mapping";

import { createApiTaskRepository } from "./api-task-repository";
import { TaskVersionConflictError } from "./repository";
import type { Task } from "../types";

const DJANGO_ORIGIN = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";
const NEXT_ORIGIN = "http://localhost:3000";

const apiTask: ApiTask = {
  id: "a1",
  title: "write plan",
  memo: "with a memo",
  done: false,
  scope_kind: "day",
  scope_value: "2026-07-27",
  bucket_category: null,
  rolled_from_kind: "day",
  rolled_from_value: "2026-07-26",
  created_at: "2026-07-27T00:00:00.000Z",
  completed_at: null,
  time: "09:30",
  due_date: "2026-07-31",
  subtasks: [{ id: "s1", title: "one", done: false, memo: "" }],
  repeat_weekdays: [1, 3],
  repeat_source: null,
  excluded_dates: null,
  priority: true,
  duration_minutes: 45,
  background: null,
  order: 2,
  version: 4,
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
  order: 2,
  version: 4,
};

/** Requests the fake Django leg received, for asserting on the outbound side. */
interface DjangoCall {
  url: string;
  method: string;
  authorization: string | null;
  ifMatch: string | null;
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
        ifMatch: headers.get("If-Match"),
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
      const [, , , id, segment, command] = url.split("/");
      if (!id) {
        return method === "POST" ? POST(request) : GET();
      }
      const params = { params: Promise.resolve({ id }) };
      if (segment === "commands" && command === "nest") {
        return NEST(request, params);
      }
      if (segment === "commands" && command === "promote-subtask") {
        return PROMOTE_SUBTASK(request, params);
      }
      if (segment === "commands" && command === "detach") {
        return DETACH(request, params);
      }
      if (segment === "commands" && command === "delete-occurrence") {
        return DELETE_OCCURRENCE(request, params);
      }
      if (segment === "commands" && command === "reschedule") {
        return RESCHEDULE(request, params);
      }
      if (segment === "commands" && command === "reorder") {
        return REORDER(request, params);
      }
      return method === "DELETE"
        ? DELETE(request, params)
        : PUT(request, params);
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
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ ...apiTask, version: apiTask.version + 1 }),
    );

    await expect(createApiTaskRepository().update(expectedTask)).resolves.toMatchObject({
      id: expectedTask.id,
      version: 5,
    });

    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/a1/`);
    expect(djangoCalls[0].method).toBe("PUT");
    expect(djangoCalls[0].ifMatch).toBe('"4"');
  });

  it("the PUT BFF distinguishes missing and invalid If-Match, then rejects a header/body mismatch", async () => {
    const params = { params: Promise.resolve({ id: "a1" }) };
    const withoutHeader = new NextRequest(`${NEXT_ORIGIN}/api/tasks/a1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expectedTask),
    });

    const required = await PUT(withoutHeader, params);
    expect(required.status).toBe(428);
    await expect(required.json()).resolves.toMatchObject({ code: "task_version_required" });

    const malformed = new NextRequest(`${NEXT_ORIGIN}/api/tasks/a1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": "3" },
      body: JSON.stringify(expectedTask),
    });
    const invalid = await PUT(malformed, params);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "task_version_invalid" });

    const mismatched = new NextRequest(`${NEXT_ORIGIN}/api/tasks/a1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": '"3"' },
      body: JSON.stringify(expectedTask),
    });
    const conflict = await PUT(mismatched, params);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "task_version_mismatch" });
  });

  it("the PUT BFF treats the URL id as authoritative", async () => {
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ ...apiTask, id: "url-id", version: 5 }),
    );
    const request = new NextRequest(`${NEXT_ORIGIN}/api/tasks/url-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": '"4"' },
      body: JSON.stringify({ ...expectedTask, id: "body-id" }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "url-id" }) });

    expect(response.status).toBe(200);
    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/url-id/`);
    expect(djangoCalls[0].ifMatch).toBe('"4"');
    expect(djangoCalls[0].body).toMatchObject({ id: "url-id", version: 4 });
  });

  it("remove() drives the [id] route's async params through to Django's 204", async () => {
    const { djangoCalls } = installFetchRouter(() => new Response(null, { status: 204 }));

    await createApiTaskRepository().remove("a1", 4);

    expect(djangoCalls[0].url).toBe(`${DJANGO_ORIGIN}/api/tasks/a1/`);
    expect(djangoCalls[0].method).toBe("DELETE");
    expect(djangoCalls[0].ifMatch).toBe('"4"');
  });

  it("the DELETE BFF distinguishes a missing If-Match from a malformed one", async () => {
    const request = new NextRequest(`${NEXT_ORIGIN}/api/tasks/a1`, { method: "DELETE" });

    const response = await DELETE(request, { params: Promise.resolve({ id: "a1" }) });

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({ code: "task_version_required" });

    const malformed = new NextRequest(`${NEXT_ORIGIN}/api/tasks/a1`, {
      method: "DELETE",
      headers: { "If-Match": '"0"' },
    });
    const invalid = await DELETE(malformed, { params: Promise.resolve({ id: "a1" }) });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "task_version_invalid" });
  });

  it("nestTask() crosses both real route layers as one command and maps its result", async () => {
    const targetApi = {
      ...apiTask,
      id: "target-id",
      subtasks: [{ id: "subtask-id", title: "write plan", done: false }],
      version: 8,
    };
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ target: targetApi, removed_task_id: "source-id" }),
    );

    const result = await createApiTaskRepository().nestTask({
      sourceId: "source-id",
      targetId: "target-id",
      sourceVersion: 3,
      targetVersion: 7,
      subtaskId: "subtask-id",
      confirmDataLoss: true,
    });

    expect(result).toEqual({
      target: {
        ...expectedTask,
        id: "target-id",
        subtasks: [{ id: "subtask-id", title: "write plan", done: false }],
        version: 8,
      },
      removedTaskId: "source-id",
    });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/source-id/commands/nest/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: {
        target_id: "target-id",
        source_version: 3,
        target_version: 7,
        subtask_id: "subtask-id",
        confirm_data_loss: true,
      },
    });
  });

  it("promoteSubtask() crosses both real route layers and returns parent plus new task", async () => {
    const parentApi = { ...apiTask, id: "parent-id", subtasks: [], version: 5 };
    const promotedApi = { ...apiTask, id: "promoted-id", title: "one", version: 1 };
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ parent: parentApi, task: promotedApi }, { status: 201 }),
    );

    const result = await createApiTaskRepository().promoteSubtask({
      parentId: "parent-id",
      subtaskId: "s1",
      parentVersion: 4,
      newTaskId: "promoted-id",
    });

    // subtasks: [] on the wire maps to `undefined` in the domain Task
    // (mapping.ts), and NextResponse.json() then drops undefined-valued
    // keys entirely during JSON serialization — so the key is genuinely
    // absent by the time it crosses the real route handler, not present
    // with an explicit undefined value. Assert absence directly instead of
    // an expected-value shape that JSON can't actually carry.
    expect(result.parent).toMatchObject({ id: "parent-id", version: 5 });
    expect(result.parent).not.toHaveProperty("subtasks");
    expect(result.task).toMatchObject({ id: "promoted-id", title: "one", version: 1 });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/parent-id/commands/promote-subtask/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: { subtask_id: "s1", parent_version: 4, new_task_id: "promoted-id" },
    });
  });

  it("detachTask() crosses both real route layers as one command and maps its result", async () => {
    const occurrenceApi = { ...apiTask, id: "occ-id", repeat_source: "anchor-id", version: 3 };
    const anchorApi = { ...apiTask, id: "anchor-id", excluded_dates: ["2026-07-16"], version: 6 };
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ occurrence: occurrenceApi, anchor: anchorApi }),
    );

    const result = await createApiTaskRepository().detachTask({
      occurrenceId: "occ-id",
      occurrenceVersion: 2,
    });

    expect(result).toEqual({
      occurrence: { ...expectedTask, id: "occ-id", repeatSourceId: "anchor-id", version: 3 },
      anchor: { ...expectedTask, id: "anchor-id", excludedDates: ["2026-07-16"], version: 6 },
    });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/occ-id/commands/detach/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: { occurrence_version: 2 },
    });
  });

  it("deleteOccurrence() crosses both real route layers and returns the removed id plus anchor", async () => {
    const anchorApi = { ...apiTask, id: "anchor-id", excluded_dates: ["2026-07-16"], version: 6 };
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ removed_task_id: "occ-id", anchor: anchorApi }),
    );

    const result = await createApiTaskRepository().deleteOccurrence({
      occurrenceId: "occ-id",
      occurrenceVersion: 2,
    });

    expect(result).toEqual({
      removedTaskId: "occ-id",
      anchor: { ...expectedTask, id: "anchor-id", excludedDates: ["2026-07-16"], version: 6 },
    });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/occ-id/commands/delete-occurrence/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: { occurrence_version: 2 },
    });
  });

  it("rescheduleTask() crosses both real route layers and maps the moved task plus anchor", async () => {
    const taskApi = {
      ...apiTask,
      id: "task-id",
      scope_value: "2026-08-03",
      rolled_from_kind: null,
      rolled_from_value: null,
      repeat_source: null,
      version: 5,
    };
    const anchorApi = { ...apiTask, id: "anchor-id", excluded_dates: ["2026-07-27"], version: 9 };
    const { djangoCalls } = installFetchRouter(() =>
      Response.json({ task: taskApi, anchor: anchorApi }),
    );

    const result = await createApiTaskRepository().rescheduleTask({
      taskId: "task-id",
      taskVersion: 4,
      date: "2026-08-03",
    });

    expect(result).toEqual({
      task: {
        ...expectedTask,
        id: "task-id",
        scope: { kind: "day", date: "2026-08-03" },
        rolledFrom: undefined,
        repeatSourceId: undefined,
        version: 5,
      },
      anchor: { ...expectedTask, id: "anchor-id", excludedDates: ["2026-07-27"], version: 9 },
    });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/task-id/commands/reschedule/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: { task_version: 4, date: "2026-08-03" },
    });
  });

  it("reorderTask() crosses both real route layers and maps the reordered task", async () => {
    const taskApi = { ...apiTask, id: "task-id", order: 2.5, version: 5 };
    const { djangoCalls } = installFetchRouter(() => Response.json({ task: taskApi }));

    const result = await createApiTaskRepository().reorderTask({
      taskId: "task-id",
      taskVersion: 4,
      insertBeforeId: "neighbor-id",
    });

    expect(result).toEqual({
      task: { ...expectedTask, id: "task-id", order: 2.5, version: 5 },
    });
    expect(djangoCalls).toHaveLength(1);
    expect(djangoCalls[0]).toMatchObject({
      url: `${DJANGO_ORIGIN}/api/tasks/task-id/commands/reorder/`,
      method: "POST",
      authorization: "Bearer test-token",
      body: { task_version: 4, insert_before_id: "neighbor-id" },
    });
  });

  it("the reorder BFF route rejects a malformed body before ever calling Django", async () => {
    const { djangoCalls } = installFetchRouter(() => {
      throw new Error("Django should not have been called for a malformed command body.");
    });
    const params = { params: Promise.resolve({ id: "task-id" }) };

    const missingVersion = new NextRequest(`${NEXT_ORIGIN}/api/tasks/task-id/commands/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insertBeforeId: null }), // taskVersion omitted
    });
    const response = await REORDER(missingVersion, params);

    expect(response.status).toBe(400);
    expect(djangoCalls).toHaveLength(0);
  });

  it("preserves Django's reorder invalid_neighbor 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        { code: "invalid_neighbor", detail: "The neighbor task is not a valid insertion point." },
        { status: 409 },
      ),
    );

    const error = await createApiTaskRepository()
      .reorderTask({ taskId: "task-id", taskVersion: 1, insertBeforeId: "does-not-exist" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TaskVersionConflictError);
    expect((error as InstanceType<typeof TaskVersionConflictError>).code).toBe("invalid_neighbor");
  });

  it("the command BFF routes reject a malformed body before ever calling Django", async () => {
    // RF-005 review finding: these routes used to hand the parsed body
    // straight to Django with no shape check, unlike the PUT route's
    // careful If-Match validation — a missing confirmDataLoss silently
    // became `undefined` and vanished during JSON.stringify instead of
    // failing fast with a clear error.
    const { djangoCalls } = installFetchRouter(() => {
      throw new Error("Django should not have been called for a malformed command body.");
    });
    const params = { params: Promise.resolve({ id: "source-id" }) };

    const missingConfirm = new NextRequest(`${NEXT_ORIGIN}/api/tasks/source-id/commands/nest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: "target-id",
        sourceVersion: 1,
        targetVersion: 1,
        subtaskId: "s1",
        // confirmDataLoss omitted
      }),
    });
    const nestResponse = await NEST(missingConfirm, params);
    expect(nestResponse.status).toBe(400);

    const missingVersion = new NextRequest(
      `${NEXT_ORIGIN}/api/tasks/source-id/commands/promote-subtask`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtaskId: "s1", newTaskId: "new-id" }), // parentVersion omitted
      },
    );
    const promoteResponse = await PROMOTE_SUBTASK(missingVersion, params);
    expect(promoteResponse.status).toBe(400);

    const missingOccurrenceVersion = new NextRequest(
      `${NEXT_ORIGIN}/api/tasks/source-id/commands/detach`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // occurrenceVersion omitted
      },
    );
    const detachResponse = await DETACH(missingOccurrenceVersion, params);
    expect(detachResponse.status).toBe(400);

    const missingDeleteOccurrenceVersion = new NextRequest(
      `${NEXT_ORIGIN}/api/tasks/source-id/commands/delete-occurrence`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // occurrenceVersion omitted
      },
    );
    const deleteOccurrenceResponse = await DELETE_OCCURRENCE(missingDeleteOccurrenceVersion, params);
    expect(deleteOccurrenceResponse.status).toBe(400);

    const missingRescheduleFields = new NextRequest(
      `${NEXT_ORIGIN}/api/tasks/source-id/commands/reschedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskVersion: 1 }), // date omitted
      },
    );
    const rescheduleResponse = await RESCHEDULE(missingRescheduleFields, params);
    expect(rescheduleResponse.status).toBe(400);

    expect(djangoCalls).toHaveLength(0);
  });

  it("preserves Django command 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        { code: "version_conflict", detail: "The task changed after it was loaded." },
        { status: 409 },
      ),
    );

    await expect(
      createApiTaskRepository().nestTask({
        sourceId: "source-id",
        targetId: "target-id",
        sourceVersion: 1,
        targetVersion: 1,
        subtaskId: "subtask-id",
        confirmDataLoss: false,
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
  });

  it("preserves Django's detach 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        { code: "task_version_conflict", detail: "The task changed after it was loaded." },
        { status: 409 },
      ),
    );

    const error = await createApiTaskRepository()
      .detachTask({ occurrenceId: "occ-id", occurrenceVersion: 1 })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TaskVersionConflictError);
    expect((error as InstanceType<typeof TaskVersionConflictError>).code).toBe(
      "task_version_conflict",
    );
  });

  it("preserves Django's delete-occurrence 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        { code: "task_version_conflict", detail: "The task changed after it was loaded." },
        { status: 409 },
      ),
    );

    const error = await createApiTaskRepository()
      .deleteOccurrence({ occurrenceId: "occ-id", occurrenceVersion: 1 })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TaskVersionConflictError);
    expect((error as InstanceType<typeof TaskVersionConflictError>).code).toBe(
      "task_version_conflict",
    );
  });

  it("preserves Django's reschedule same_date 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        { code: "same_date", detail: "The task is already scheduled on this date." },
        { status: 409 },
      ),
    );

    const error = await createApiTaskRepository()
      .rescheduleTask({ taskId: "task-id", taskVersion: 1, date: "2026-07-16" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TaskVersionConflictError);
    expect((error as InstanceType<typeof TaskVersionConflictError>).code).toBe("same_date");
  });

  it("preserves Django's reschedule not_reschedulable 409 through the BFF as a typed repository conflict", async () => {
    installFetchRouter(() =>
      Response.json(
        {
          code: "not_reschedulable",
          detail: "Only a day-scoped task or a rolled-over week-scoped task can be rescheduled.",
        },
        { status: 409 },
      ),
    );

    const error = await createApiTaskRepository()
      .rescheduleTask({ taskId: "task-id", taskVersion: 1, date: "2026-07-16" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TaskVersionConflictError);
    expect((error as InstanceType<typeof TaskVersionConflictError>).code).toBe(
      "not_reschedulable",
    );
  });

  it("a non-auth Django failure propagates through the real route handler as a rejected list()", async () => {
    installFetchRouter(() => Response.json({ detail: "server exploded" }, { status: 500 }));

    await expect(createApiTaskRepository().list()).rejects.toThrow("Failed to load tasks.");
  });

  it("a Django 401 propagates through the real route handler's own 401, and the client redirects to login instead of a generic sync failure", async () => {
    installFetchRouter(() => Response.json({ detail: "token expired" }, { status: 401 }));
    const redirectToLogin = vi.fn();

    await expect(createApiTaskRepository(redirectToLogin).list()).rejects.toThrow();

    expect(redirectToLogin).toHaveBeenCalledOnce();
  });
});
