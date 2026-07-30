import type { Task } from "../types";

export function normalizeCategoryInput(input: string): string {
  return input.trim();
}

// Case-insensitive match against categories already in use; returns the
// EXISTING display casing on a match, or the trimmed input if it's new —
// so "to eat" typed against an existing "To Eat" reuses "To Eat" rather
// than creating a second, differently-cased category.
export function resolveCategoryCasing(input: string, existingCategories: string[]): string {
  const trimmed = normalizeCategoryInput(input);
  const existing = existingCategories.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  return existing ?? trimmed;
}

export interface BucketCategoryGroup {
  category: string;
  active: Task[];
  completed: Task[];
}

// One entry per distinct category among bucket-scoped tasks, ordered by the
// earliest createdAt among that category's own tasks (not alphabetical).
// Within each group: active tasks first, completed below, both in stable
// creation order.
export function groupBucketTasks(tasks: Task[]): BucketCategoryGroup[] {
  const bucketTasks = tasks.filter(
    (t): t is Task & { scope: { kind: "bucket"; category: string } } => t.scope.kind === "bucket",
  );

  const byCategory = new Map<string, Task[]>();
  for (const t of bucketTasks) {
    const list = byCategory.get(t.scope.category) ?? [];
    list.push(t);
    byCategory.set(t.scope.category, list);
  }

  const withOrderKey = Array.from(byCategory.entries()).map(([category, items]) => {
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      category,
      active: sorted.filter((t) => !t.done),
      completed: sorted.filter((t) => t.done),
      earliestCreatedAt: sorted[0].createdAt,
    };
  });

  withOrderKey.sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));

  return withOrderKey.map(({ category, active, completed }) => ({ category, active, completed }));
}

export function bucketCategoriesInUse(tasks: Task[]): string[] {
  return groupBucketTasks(tasks).map((g) => g.category);
}
