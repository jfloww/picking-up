import { apiRequest } from "@/lib/api/server";

import { categoryFromApiPayload, type ApiCategory } from "./mapping";
import type { Category } from "../types";

export async function requestListCategories(): Promise<Category[]> {
  const payloads = await apiRequest<ApiCategory[]>("/api/categories/", { authenticated: true });
  return payloads.map(categoryFromApiPayload);
}

export async function requestCreateCategory(name: string): Promise<Category> {
  const payload = await apiRequest<ApiCategory>("/api/categories/", {
    method: "POST",
    body: JSON.stringify({ name }),
    authenticated: true,
  });
  return categoryFromApiPayload(payload);
}

export async function requestRenameCategory(id: string, name: string): Promise<Category> {
  const payload = await apiRequest<ApiCategory>(`/api/categories/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
    authenticated: true,
  });
  return categoryFromApiPayload(payload);
}
