import type { FocusSettings } from "../types";

export interface FocusRepository {
  load(): Promise<FocusSettings>;
  save(settings: FocusSettings): Promise<FocusSettings>;
}

export function createApiFocusRepository(): FocusRepository {
  return {
    async load() {
      const response = await fetch("/api/focus-settings");
      if (!response.ok) throw new Error("Failed to load focus areas.");
      return (await response.json()) as FocusSettings;
    },
    async save(settings) {
      const response = await fetch("/api/focus-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error("Failed to save focus areas.");
      return (await response.json()) as FocusSettings;
    },
  };
}
