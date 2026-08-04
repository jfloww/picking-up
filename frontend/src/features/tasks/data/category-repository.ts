import type { Category } from "../types";

export interface CategoryRepository {
  list(): Promise<Category[]>;
  create(name: string): Promise<Category>;
  rename(id: string, name: string): Promise<Category>;
}

// Unlike TaskRepository, there's no offline/localStorage variant — category
// creation is always awaited (never optimistic; see store.tsx's
// createCategory), so there's nothing for a legacy-migration path to upload.
//
// This must go through the Next.js proxy routes via plain fetch, the same
// way api-task-repository.ts does — never call features/tasks/api/categories
// directly from here. That module uses apiRequest/getAccessToken, which
// depend on next/headers and only work in a Route Handler; importing it from
// this client-side repository (reached from store.tsx, a "use client"
// component) pulls next/headers into the browser bundle and breaks the app.
export function createApiCategoryRepository(): CategoryRepository {
  return {
    async list() {
      const response = await fetch("/api/categories");
      if (!response.ok) throw new Error("Failed to load categories.");
      return (await response.json()) as Category[];
    },
    async create(name) {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Failed to save category.");
      return (await response.json()) as Category;
    },
    async rename(id, name) {
      const response = await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Failed to rename category.");
      return (await response.json()) as Category;
    },
  };
}
