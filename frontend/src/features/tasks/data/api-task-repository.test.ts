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
    expect(fetchSpy).toHaveBeenCalledWith("/api/tasks");
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

  it("list() retries only the tasks that failed to migrate, clearing the ones that succeeded", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([a, b]));
    const server = [makeTask({ id: "from-another-device" })];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500)) // fails on task a
      .mockResolvedValueOnce(jsonResponse({ id: "b" }, 201)) // b still gets attempted, and succeeds
      .mockResolvedValueOnce(jsonResponse(server)); // list() still runs
    vi.stubGlobal("fetch", fetchSpy);

    // A stuck task must not brick the app, and must not block the rest of
    // the batch: list() resolves with the real server list, and b still
    // gets migrated even though a failed.
    await expect(createApiTaskRepository().list()).resolves.toEqual(server);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: "POST" });
    // Only the task that actually failed is kept for a later retry — b,
    // which succeeded, must be cleared so it's never re-uploaded on a later
    // load (which could otherwise resurrect a task the user has since
    // deleted from the server).
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([a]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("list() still rejects when the list fetch itself fails", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createApiTaskRepository().list()).rejects.toThrow("Failed to load tasks.");
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

    expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/x", expect.objectContaining({ method: "PUT" }));
  });

  it("remove() deletes at the id's url and throws on failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchSpy);

    await createApiTaskRepository().remove("x");

    expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/x", expect.objectContaining({ method: "DELETE" }));
  });

  describe("on a 401 (session expired)", () => {
    it("list() redirects to login instead of surfacing a generic sync failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();

      await expect(createApiTaskRepository(redirectToLogin).list()).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it("create() redirects to login", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();

      await expect(createApiTaskRepository(redirectToLogin).create(makeTask())).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it("update() redirects to login", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();

      await expect(
        createApiTaskRepository(redirectToLogin).update(makeTask()),
      ).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it("remove() redirects to login", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();

      await expect(createApiTaskRepository(redirectToLogin).remove("x")).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it("list() redirects to login when the legacy-migration upload itself hits a 401, without logging a misleading migration-failure message", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([makeTask({ id: "a" })]));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(createApiTaskRepository(redirectToLogin).list()).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
      expect(consoleSpy).not.toHaveBeenCalled();
      // localStorage is left alone — this wasn't a migration-specific
      // failure, so there's nothing to retry differently next time.
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      consoleSpy.mockRestore();
    });
  });
});
