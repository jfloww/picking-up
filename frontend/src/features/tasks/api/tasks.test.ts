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
