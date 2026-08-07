import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server-cookies", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

import type { ApiTask } from "./mapping";
import {
  TaskApiError,
  requestCreateTask,
  requestDeleteTask,
  requestListTasks,
  requestNestTask,
  requestPromoteSubtask,
  requestUpdateTask,
} from "./tasks";
import type { Task } from "../types";

const apiTask: ApiTask = {
  id: "a1",
  title: "write plan",
  memo: null,
  done: false,
  scope_kind: "day",
  scope_value: "2026-07-27",
  bucket_category: null,
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
  order: 0,
  version: 4,
};

const task: Task = {
  id: "a1",
  title: "write plan",
  done: false,
  scope: { kind: "day", date: "2026-07-27" },
  createdAt: "2026-07-27T00:00:00.000Z",
  order: 0,
  version: 4,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
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

  it("throws when the response is not ok, preserving Django's own error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "nope" }, 500)));
    await expect(requestListTasks()).rejects.toThrow("nope");
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
    expect(JSON.parse(init.body as string)).toMatchObject({
      id: "a1",
      scope_kind: "day",
      version: 4,
    });
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
  it("puts the mapped payload to the URL id and sends the current version as If-Match", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ...apiTask, version: 5 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestUpdateTask("url-id", task);

    expect(result).toEqual({ ...task, version: 5 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/tasks/url-id/");
    expect(init.method).toBe("PUT");
    expect((init.headers as Headers).get("If-Match")).toBe('"4"');
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("preserves a stale-write 409 as a status-aware TaskApiError", async () => {
    const body = { code: "version_conflict", detail: "The task changed after it was loaded." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, 409)));

    const error = await requestUpdateTask("a1", task).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TaskApiError);
    expect(error).toMatchObject({ status: 409, body });
  });

  it("throws when the response is not ok, preserving Django's own error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "repeat_source does not exist" }, 400)),
    );
    await expect(requestUpdateTask("a1", task)).rejects.toThrow("repeat_source does not exist");
  });
});

describe("requestDeleteTask", () => {
  it("deletes at the id's URL with an If-Match precondition", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchSpy);

    await requestDeleteTask("a1", 4);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/tasks/a1/");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Headers).get("If-Match")).toBe('"4"');
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(requestDeleteTask("a1", 4)).rejects.toThrow();
  });
});

describe("task commands", () => {
  it("maps and posts a nest command, then maps the authoritative target", async () => {
    const targetApi = {
      ...apiTask,
      id: "target-id",
      subtasks: [{ id: "new-subtask", title: "write plan", done: false }],
      version: 8,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ target: targetApi, removed_task_id: "source-id" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestNestTask("source-id", {
      targetId: "target-id",
      sourceVersion: 3,
      targetVersion: 7,
      subtaskId: "new-subtask",
      confirmDataLoss: true,
    });

    expect(result).toEqual({
      target: {
        ...task,
        id: "target-id",
        subtasks: [{ id: "new-subtask", title: "write plan", done: false }],
        version: 8,
      },
      removedTaskId: "source-id",
      status: 200,
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/tasks/source-id/commands/nest/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      target_id: "target-id",
      source_version: 3,
      target_version: 7,
      subtask_id: "new-subtask",
      confirm_data_loss: true,
    });
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("maps and posts a promote-subtask command and both authoritative tasks", async () => {
    const parentApi = { ...apiTask, id: "parent-id", subtasks: [], version: 5 };
    const promotedApi = {
      ...apiTask,
      id: "new-task-id",
      title: "promoted",
      version: 1,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ parent: parentApi, task: promotedApi }, 201),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestPromoteSubtask("parent-id", {
      subtaskId: "subtask-id",
      parentVersion: 4,
      newTaskId: "new-task-id",
    });

    expect(result).toEqual({
      parent: { ...task, id: "parent-id", version: 5 },
      task: { ...task, id: "new-task-id", title: "promoted", version: 1 },
      status: 201,
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/tasks/parent-id/commands/promote-subtask/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      subtask_id: "subtask-id",
      parent_version: 4,
      new_task_id: "new-task-id",
    });
  });

  it("preserves a command version conflict and its machine-readable body", async () => {
    const body = { code: "version_conflict", detail: "The task changed after it was loaded." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, 409)));

    const error = await requestNestTask("source-id", {
      targetId: "target-id",
      sourceVersion: 1,
      targetVersion: 1,
      subtaskId: "new-subtask",
      confirmDataLoss: false,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TaskApiError);
    expect(error).toMatchObject({ status: 409, body });
  });
});
