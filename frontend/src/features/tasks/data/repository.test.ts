import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import {
  createLocalStorageRepository,
  normalizeTask,
  TaskVersionConflictError,
  type TaskStorage,
} from "./repository";

function fakeStorage(initial: Record<string, string> = {}): TaskStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

const task: Task = {
  id: "a",
  title: "buy milk",
  done: false,
  scope: { kind: "day", date: "2026-07-16" },
  createdAt: "2026-07-16T00:00:00.000Z",
  order: 0,
  version: 1,
};

describe("createLocalStorageRepository", () => {
  it("round-trips create/list/update/remove", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    await repo.create(task);
    const [loaded] = await repo.list();
    expect(loaded).toMatchObject(task);
    expect(loaded.version).toBe(1);

    const updated = await repo.update({ ...task, done: true });
    expect(updated).toMatchObject({ done: true, version: 2 });
    expect((await repo.list())[0]).toMatchObject({ done: true, version: 2 });

    await repo.remove("a", 2);
    expect(await repo.list()).toEqual([]);
  });

  it("normalizes pre-version legacy tasks to version 1", async () => {
    const legacyTask = { ...task } as Partial<Task>;
    delete legacyTask.version;
    const repo = createLocalStorageRepository(
      fakeStorage({ "picking-up.tasks.v1": JSON.stringify([legacyTask]) }),
    );

    const [loaded] = await repo.list();
    expect(loaded).toMatchObject(task);
    expect(loaded.version).toBe(1);
  });

  it("rejects stale update and delete preconditions without changing storage", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    await repo.create(task);

    await expect(repo.update({ ...task, version: 2, done: true })).rejects.toBeInstanceOf(
      TaskVersionConflictError,
    );
    await expect(repo.remove(task.id, 2)).rejects.toBeInstanceOf(TaskVersionConflictError);
    expect(await repo.list()).toEqual([task]);
  });

  it("nests with one authoritative result and rejects a stale retry", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const source = { ...task, id: "source", title: "buy milk" };
    const target = { ...task, id: "target", title: "groceries", version: 3 };
    await repo.create(source);
    await repo.create(target);
    // create() establishes version 1 regardless of a caller-provided value.

    const result = await repo.nestTask({
      sourceId: source.id,
      targetId: target.id,
      sourceVersion: 1,
      targetVersion: 1,
      subtaskId: "subtask-id",
      confirmDataLoss: false,
    });

    expect(result).toEqual({
      target: {
        ...target,
        version: 2,
        subtasks: [{ id: "subtask-id", title: "buy milk", done: false }],
      },
      removedTaskId: source.id,
    });
    expect(await repo.list()).toEqual([result.target]);
    await expect(
      repo.nestTask({
        sourceId: source.id,
        targetId: target.id,
        sourceVersion: 1,
        targetVersion: 1,
        subtaskId: "another-id",
        confirmDataLoss: false,
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
    expect(await repo.list()).toEqual([result.target]);
  });

  it("promotes a subtask and increments only the existing parent's version", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const parent = {
      ...task,
      id: "parent",
      title: "trip",
      order: 2,
      subtasks: [{ id: "subtask-id", title: "book flights", done: true }],
    };
    await repo.create(parent);

    const result = await repo.promoteSubtask({
      parentId: parent.id,
      subtaskId: "subtask-id",
      parentVersion: 1,
      newTaskId: "promoted-id",
    });

    expect(result.parent).toMatchObject({ id: parent.id, subtasks: [], version: 2 });
    expect(result.task).toMatchObject({
      id: "promoted-id",
      title: "book flights",
      done: true,
      order: 3,
      version: 1,
    });
    expect(await repo.list()).toEqual([result.parent, result.task]);
  });

  it("detaches an occurrence, clearing repeatSourceId and excluding the date on the anchor", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const anchor: Task = {
      ...task,
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    };
    const occurrence: Task = {
      ...task,
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    };
    await repo.create(anchor);
    await repo.create(occurrence);

    const result = await repo.detachTask({ occurrenceId: "occ", occurrenceVersion: 1 });

    expect(result.occurrence.repeatSourceId).toBeUndefined();
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
    expect(await repo.list()).toEqual([result.anchor, result.occurrence]);
  });

  it("detachTask throws TaskVersionConflictError on a stale version", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const occurrence = { ...task, id: "occ" };
    await repo.create(occurrence);

    await expect(
      repo.detachTask({ occurrenceId: "occ", occurrenceVersion: 99 }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
  });

  it("deleteOccurrence removes the task and excludes its date on the anchor", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const anchor: Task = {
      ...task,
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    };
    const occurrence: Task = {
      ...task,
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    };
    await repo.create(anchor);
    await repo.create(occurrence);

    const result = await repo.deleteOccurrence({ occurrenceId: "occ", occurrenceVersion: 1 });

    expect(result.removedTaskId).toBe("occ");
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
    expect(await repo.list()).toEqual([result.anchor]);
  });

  it("deleteOccurrence throws TaskVersionConflictError on a stale version", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const occurrence = { ...task, id: "occ" };
    await repo.create(occurrence);

    await expect(
      repo.deleteOccurrence({ occurrenceId: "occ", occurrenceVersion: 99 }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
  });

  it("rescheduleTask moves a day-scoped task and excludes the old date on its anchor", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const anchor: Task = {
      ...task,
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    };
    const occurrence: Task = {
      ...task,
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    };
    await repo.create(anchor);
    await repo.create(occurrence);

    const result = await repo.rescheduleTask({ taskId: "occ", taskVersion: 1, date: "2026-07-20" });

    expect(result.task.scope).toEqual({ kind: "day", date: "2026-07-20" });
    expect(result.task.repeatSourceId).toBeUndefined();
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
    expect(await repo.list()).toEqual([result.anchor, result.task]);
  });

  it("rescheduleTask rejects the same effective date", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const a: Task = { ...task, id: "a", scope: { kind: "day", date: "2026-07-16" } };
    await repo.create(a);

    await expect(
      repo.rescheduleTask({ taskId: "a", taskVersion: 1, date: "2026-07-16" }),
    ).rejects.toThrow();
  });

  it("rescheduleTask throws TaskVersionConflictError on a stale version", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const a = { ...task, id: "a" };
    await repo.create(a);

    await expect(
      repo.rescheduleTask({ taskId: "a", taskVersion: 99, date: "2026-07-20" }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
  });

  it("returns [] for missing, corrupt, or non-array data", async () => {
    expect(
      await createLocalStorageRepository(fakeStorage()).list(),
    ).toEqual([]);
    expect(
      await createLocalStorageRepository(
        fakeStorage({ "picking-up.tasks.v1": "{not json" }),
      ).list(),
    ).toEqual([]);
    expect(
      await createLocalStorageRepository(
        fakeStorage({ "picking-up.tasks.v1": '{"a":1}' }),
      ).list(),
    ).toEqual([]);
  });

  it("filters out malformed entries but keeps valid ones", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([
          task,
          { junk: true },
          null,
          { ...task, id: "bad1", scope: { kind: "day" } },
          { ...task, id: "bad2", scope: { kind: "day", date: 123 } },
        ]),
      }),
    );
    expect(await repo.list()).toEqual([task]);
  });
});

describe("v2 field normalization", () => {
  it("round-trips time and subtasks", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const timed: Task = {
      ...task,
      id: "timed",
      time: "09:30",
      subtasks: [{ id: "s1", title: "detail", done: false }],
    };
    await repo.create(timed);
    expect(await repo.list()).toEqual([timed]);
  });

  it("clears an invalid time but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, time: "25:99" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.time).toBeUndefined();
  });

  it("drops a non-array subtasks field but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, subtasks: "junk" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.subtasks).toBeUndefined();
  });

  it("filters malformed subtask entries, keeping valid ones", async () => {
    const good = { id: "s1", title: "ok", done: true };
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([
          { ...task, subtasks: [good, { id: "s2" }, null, { id: 3, title: "x", done: false }] },
        ]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.subtasks).toEqual([good]);
  });

  it("round-trips valid repeatWeekdays and repeatSourceId", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const routine: Task = { ...task, id: "anchor", repeatWeekdays: [1, 3, 5] };
    const occurrence: Task = { ...task, id: "occ", repeatSourceId: "anchor" };
    await repo.create(routine);
    await repo.create(occurrence);
    expect(await repo.list()).toEqual([routine, occurrence]);
  });

  it("clears an invalid repeatWeekdays but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, repeatWeekdays: [3, 9] }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.repeatWeekdays).toBeUndefined();
  });

  it("clears a non-string repeatSourceId but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, repeatSourceId: 42 }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.repeatSourceId).toBeUndefined();
  });

  it("round-trips a valid excludedDates array", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const anchor: Task = { ...task, id: "anchor", excludedDates: ["2026-07-09", "2026-07-16"] };
    await repo.create(anchor);
    expect(await repo.list()).toEqual([anchor]);
  });

  it("clears a malformed excludedDates value but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, excludedDates: [1, 2, 3] }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.excludedDates).toBeUndefined();
  });

  it("normalizeTask returns the same reference when nothing changed", () => {
    const clean: Task = {
      ...task,
      id: "clean",
      time: "09:30",
      subtasks: [{ id: "s1", title: "ok", done: false }],
      repeatWeekdays: [0, 6],
      priority: true,
      durationMinutes: 45,
      background: true,
    };
    expect(normalizeTask(clean)).toBe(clean);
    const bare: Task = { ...task, id: "bare" };
    expect(normalizeTask(bare)).toBe(bare);
  });

  it("round-trips a valid priority flag", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const prioritized: Task = { ...task, id: "prioritized", priority: true };
    await repo.create(prioritized);
    expect(await repo.list()).toEqual([prioritized]);
  });

  it("clears a non-boolean priority but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, priority: "yes" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.priority).toBeUndefined();
  });

  it("round-trips a valid durationMinutes", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const timed: Task = { ...task, id: "timed", time: "09:00", durationMinutes: 45 };
    await repo.create(timed);
    expect(await repo.list()).toEqual([timed]);
  });

  it("clears a non-positive-integer durationMinutes but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([
          { ...task, id: "a", durationMinutes: "45" },
          { ...task, id: "b", durationMinutes: -30 },
          { ...task, id: "c", durationMinutes: 0 },
          { ...task, id: "d", durationMinutes: 12.5 },
        ]),
      }),
    );
    const loaded = await repo.list();
    expect(loaded.every((t) => t.durationMinutes === undefined)).toBe(true);
    expect(loaded.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("round-trips a valid background flag", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const backgrounded: Task = { ...task, id: "backgrounded", background: true };
    await repo.create(backgrounded);
    expect(await repo.list()).toEqual([backgrounded]);
  });

  it("clears a non-boolean background but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, background: "yes" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.background).toBeUndefined();
  });
});
