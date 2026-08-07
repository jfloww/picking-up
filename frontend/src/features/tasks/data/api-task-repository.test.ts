import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiTaskRepository, TASK_REQUEST_TIMEOUT_MS } from "./api-task-repository";
import { STORAGE_KEY, TaskVersionConflictError } from "./repository";
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("list() fetches the server list directly when localStorage has nothing to migrate", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    const tasks = await createApiTaskRepository().list();

    expect(tasks).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts a request that exceeds the task request timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_input, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const request = createApiTaskRepository().list();
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(TASK_REQUEST_TIMEOUT_MS);

    await rejection;
    expect(signal?.aborted).toBe(true);
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

  it("update() puts the versioned task to its own URL and returns the authoritative task", async () => {
    const task = makeTask({ id: "x", version: 3 });
    const authoritative = { ...task, title: "saved by server", version: 4 };
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(authoritative, 200));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createApiTaskRepository().update(task)).resolves.toEqual(authoritative);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tasks/x",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": '"3"' },
        body: JSON.stringify(task),
      }),
    );
  });

  it("remove() deletes at the id's URL with the current version", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchSpy);

    await createApiTaskRepository().remove("x", 6);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tasks/x",
      expect.objectContaining({ method: "DELETE", headers: { "If-Match": '"6"' } }),
    );
  });

  it("turns mutation and command 409 responses into TaskVersionConflictError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: "version_conflict" }, 409)));
    const repo = createApiTaskRepository();

    await expect(repo.update(makeTask())).rejects.toBeInstanceOf(TaskVersionConflictError);
    await expect(
      repo.nestTask({
        sourceId: "source",
        targetId: "target",
        sourceVersion: 1,
        targetVersion: 1,
        subtaskId: "subtask",
        confirmDataLoss: false,
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
  });

  it("preserves the server's conflict code and current versions on the thrown error", async () => {
    // RF-005 review finding: this information used to be discarded at the
    // repository boundary, leaving the store unable to tell a genuine
    // staleness conflict apart from any other failure.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: "task_version_conflict", current_versions: { "task-1": 4 } },
          409,
        ),
      ),
    );
    const repo = createApiTaskRepository();

    try {
      await repo.update(makeTask({ id: "task-1" }));
      expect.unreachable("expected update() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskVersionConflictError);
      const conflict = error as TaskVersionConflictError;
      expect(conflict.code).toBe("task_version_conflict");
      expect(conflict.currentVersions).toEqual({ "task-1": 4 });
    }
  });

  it("nestTask() sends one command request and returns the authoritative target", async () => {
    const target = makeTask({
      id: "target",
      subtasks: [{ id: "subtask", title: "source", done: false }],
      version: 2,
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ target, removedTaskId: "source" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      createApiTaskRepository().nestTask({
        sourceId: "source",
        targetId: "target",
        sourceVersion: 1,
        targetVersion: 1,
        subtaskId: "subtask",
        confirmDataLoss: true,
      }),
    ).resolves.toEqual({ target, removedTaskId: "source" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tasks/source/commands/nest",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceId: "source",
          targetId: "target",
          sourceVersion: 1,
          targetVersion: 1,
          subtaskId: "subtask",
          confirmDataLoss: true,
        }),
      }),
    );
  });

  it("promoteSubtask() sends one command request and returns both authoritative tasks", async () => {
    const parent = makeTask({ id: "parent", subtasks: [], version: 2 });
    const task = makeTask({ id: "promoted", title: "book flights", version: 1 });
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ parent, task }, 201));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      createApiTaskRepository().promoteSubtask({
        parentId: "parent",
        subtaskId: "subtask",
        parentVersion: 1,
        newTaskId: "promoted",
      }),
    ).resolves.toEqual({ parent, task });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tasks/parent/commands/promote-subtask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          parentId: "parent",
          subtaskId: "subtask",
          parentVersion: 1,
          newTaskId: "promoted",
        }),
      }),
    );
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

      await expect(createApiTaskRepository(redirectToLogin).remove("x", 1)).rejects.toThrow();

      expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it("nestTask() redirects to login", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
      const redirectToLogin = vi.fn();

      await expect(
        createApiTaskRepository(redirectToLogin).nestTask({
          sourceId: "source",
          targetId: "target",
          sourceVersion: 1,
          targetVersion: 1,
          subtaskId: "subtask",
          confirmDataLoss: false,
        }),
      ).rejects.toThrow();

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
