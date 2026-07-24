import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { createLocalStorageRepository, normalizeTask, type TaskStorage } from "./repository";

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
};

describe("createLocalStorageRepository", () => {
  it("round-trips create/list/update/remove", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    await repo.create(task);
    expect(await repo.list()).toEqual([task]);

    await repo.update({ ...task, done: true });
    expect((await repo.list())[0].done).toBe(true);

    await repo.remove("a");
    expect(await repo.list()).toEqual([]);
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
