import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { groupBucketTasks } from "./categories";
import type { Category } from "../types";

function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "cat-default", name: "Default", createdAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("groupBucketTasks", () => {
  it("orders groups by the category's own createdAt, not task data", () => {
    const toGo = makeCategory({ id: "c-go", name: "To Go", createdAt: "2026-07-02T00:00:00.000Z" });
    const toEat = makeCategory({ id: "c-eat", name: "To Eat", createdAt: "2026-07-01T00:00:00.000Z" });
    // toGo's only task is created *earlier* than toEat's, but toEat's
    // category itself was created earlier — category createdAt must win.
    const tasks = [
      makeTask({ id: "1", scope: { kind: "bucket", categoryId: "c-go" }, createdAt: "2026-06-01T00:00:00.000Z" }),
      makeTask({ id: "2", scope: { kind: "bucket", categoryId: "c-eat" }, createdAt: "2026-06-15T00:00:00.000Z" }),
    ];

    const groups = groupBucketTasks(tasks, [toGo, toEat]);

    expect(groups.map((g) => g.categoryId)).toEqual(["c-eat", "c-go"]);
  });

  it("includes a category with zero tasks as an empty group", () => {
    const empty = makeCategory({ id: "c-empty", name: "Someday" });
    const groups = groupBucketTasks([], [empty]);
    expect(groups).toEqual([{ categoryId: "c-empty", categoryName: "Someday", active: [], completed: [] }]);
  });

  it("within a category: active first, completed below, both in creation order", () => {
    const category = makeCategory({ id: "c-1" });
    const tasks = [
      makeTask({ id: "done-1", done: true, scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-01T00:00:00.000Z" }),
      makeTask({ id: "active-1", scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-02T00:00:00.000Z" }),
      makeTask({ id: "active-2", scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-03T00:00:00.000Z" }),
    ];

    const [group] = groupBucketTasks(tasks, [category]);

    expect(group.active.map((t) => t.id)).toEqual(["active-1", "active-2"]);
    expect(group.completed.map((t) => t.id)).toEqual(["done-1"]);
  });

  it("ignores a bucket-scoped task whose categoryId matches no known category", () => {
    const category = makeCategory({ id: "c-1" });
    const orphan = makeTask({ scope: { kind: "bucket", categoryId: "deleted-category" } });

    const groups = groupBucketTasks([orphan], [category]);

    expect(groups).toEqual([{ categoryId: "c-1", categoryName: "Default", active: [], completed: [] }]);
  });

  it("does not include day/week/month/year-scoped tasks in any group", () => {
    const category = makeCategory({ id: "c-1" });
    const dayTask = makeTask({ scope: { kind: "day", date: "2026-07-16" } });

    const [group] = groupBucketTasks([dayTask], [category]);

    expect(group.active).toEqual([]);
    expect(group.completed).toEqual([]);
  });
});
