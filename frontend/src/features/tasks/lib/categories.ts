import type { Category, Task } from "../types";

export interface BucketCategoryGroup {
  categoryId: string;
  categoryName: string;
  active: Task[];
  completed: Task[];
}

// One entry per saved Category (not per category-in-use) — an empty
// category still produces a group with empty arrays. Ordered by the
// category's own createdAt, ascending; never derived from task data.
// Within each group: active tasks first, completed below, both in stable
// creation order.
export function groupBucketTasks(tasks: Task[], categories: Category[]): BucketCategoryGroup[] {
  const bucketTasks = tasks.filter(
    (t): t is Task & { scope: { kind: "bucket"; categoryId: string } } => t.scope.kind === "bucket",
  );

  const byCategory = new Map<string, Task[]>();
  for (const t of bucketTasks) {
    const list = byCategory.get(t.scope.categoryId) ?? [];
    list.push(t);
    byCategory.set(t.scope.categoryId, list);
  }

  const sortedCategories = [...categories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return sortedCategories.map((category) => {
    const items = byCategory.get(category.id) ?? [];
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      categoryId: category.id,
      categoryName: category.name,
      active: sorted.filter((t) => !t.done),
      completed: sorted.filter((t) => t.done),
    };
  });
}
