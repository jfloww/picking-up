import { describe, expect, it } from "vitest";

import {
  bucketCategoriesInUse,
  groupBucketTasks,
  normalizeCategoryInput,
  resolveCategoryCasing,
} from "./categories";
import { makeTask } from "../test-utils";

describe("normalizeCategoryInput", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeCategoryInput("  To Eat  ")).toBe("To Eat");
  });
});

describe("resolveCategoryCasing", () => {
  it("returns the trimmed input when there's no existing match", () => {
    expect(resolveCategoryCasing("  To Go  ", ["To Eat"])).toBe("To Go");
  });

  it("reuses the existing category's casing on a case-insensitive match", () => {
    expect(resolveCategoryCasing("to eat", ["To Eat"])).toBe("To Eat");
    expect(resolveCategoryCasing("TO EAT", ["To Eat"])).toBe("To Eat");
  });
});

describe("groupBucketTasks", () => {
  it("excludes tasks that aren't bucket-scoped", () => {
    const dayTask = makeTask({ id: "d1", scope: { kind: "day", date: "2026-07-16" } });
    expect(groupBucketTasks([dayTask])).toEqual([]);
  });

  it("groups tasks by category, active before completed, in stable creation order", () => {
    const tasks = [
      makeTask({
        id: "1",
        title: "ramen",
        done: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
      makeTask({
        id: "2",
        title: "sushi",
        done: false,
        createdAt: "2026-07-02T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
      makeTask({
        id: "3",
        title: "tacos",
        done: false,
        createdAt: "2026-07-03T00:00:00.000Z",
        scope: { kind: "bucket", category: "To Eat" },
      }),
    ];
    const [group] = groupBucketTasks(tasks);
    expect(group.category).toBe("To Eat");
    expect(group.active.map((t) => t.id)).toEqual(["2", "3"]);
    expect(group.completed.map((t) => t.id)).toEqual(["1"]);
  });

  it("orders categories by the earliest createdAt among their own tasks, not alphabetically", () => {
    const tasks = [
      makeTask({
        id: "1",
        createdAt: "2026-07-05T00:00:00.000Z",
        scope: { kind: "bucket", category: "Zzz Later" },
      }),
      makeTask({
        id: "2",
        createdAt: "2026-07-01T00:00:00.000Z",
        scope: { kind: "bucket", category: "Aaa Sooner" },
      }),
    ];
    const groups = groupBucketTasks(tasks);
    expect(groups.map((g) => g.category)).toEqual(["Aaa Sooner", "Zzz Later"]);
  });
});

describe("bucketCategoriesInUse", () => {
  it("returns the distinct category names in group order", () => {
    const tasks = [
      makeTask({ id: "1", createdAt: "2026-07-01T00:00:00.000Z", scope: { kind: "bucket", category: "To Go" } }),
      makeTask({ id: "2", createdAt: "2026-07-02T00:00:00.000Z", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "3", createdAt: "2026-07-03T00:00:00.000Z", scope: { kind: "bucket", category: "To Go" } }),
    ];
    expect(bucketCategoriesInUse(tasks)).toEqual(["To Go", "To Eat"]);
  });
});
