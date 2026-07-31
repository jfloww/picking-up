import { requestCreateCategory, requestListCategories, requestRenameCategory } from "../api/categories";
import type { Category } from "../types";

export interface CategoryRepository {
  list(): Promise<Category[]>;
  create(name: string): Promise<Category>;
  rename(id: string, name: string): Promise<Category>;
}

// Unlike TaskRepository, there's no offline/localStorage variant — category
// creation is always awaited (never optimistic; see store.tsx's
// createCategory), so there's nothing for a legacy-migration path to upload.
export function createApiCategoryRepository(): CategoryRepository {
  return {
    list: requestListCategories,
    create: requestCreateCategory,
    rename: requestRenameCategory,
  };
}
