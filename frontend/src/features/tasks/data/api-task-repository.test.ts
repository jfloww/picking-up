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
