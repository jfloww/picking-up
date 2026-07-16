import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { createLocalStorageRepository, type TaskStorage } from "./repository";

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
        "picking-up.tasks.v1": JSON.stringify([task, { junk: true }, null]),
      }),
    );
    expect(await repo.list()).toEqual([task]);
  });
});
