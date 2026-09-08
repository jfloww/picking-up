import type { FocusRepository } from "./data/focus-repository";
import { EMPTY_FOCUS_SETTINGS, type FocusArea, type FocusSettings } from "./types";

export function makeFocusArea(overrides: Partial<FocusArea> = {}): FocusArea {
  return {
    id: crypto.randomUUID(),
    title: "Focus area",
    description: "Make steady progress.",
    archived: false,
    ...overrides,
  };
}

export function fakeFocusRepository(
  initial: FocusSettings = EMPTY_FOCUS_SETTINGS,
): FocusRepository & { settings: FocusSettings } {
  let settings = {
    ...initial,
    focusAreas: initial.focusAreas.map((area) => ({ ...area })),
  };
  return {
    get settings() {
      return settings;
    },
    async load() {
      return settings;
    },
    async save(next) {
      settings = {
        ...next,
        focusAreas: next.focusAreas.map((area) => ({ ...area })),
        updatedAt: new Date().toISOString(),
      };
      return settings;
    },
  };
}
