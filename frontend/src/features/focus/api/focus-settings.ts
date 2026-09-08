import { apiRequest } from "@/lib/api/server";

import type { FocusArea, FocusSettings } from "../types";

interface ApiFocusArea {
  id: string;
  title: string;
  description: string;
  archived: boolean;
}

interface ApiFocusSettings {
  focus_areas: ApiFocusArea[];
  active_focus_id: string | null;
  updated_at: string | null;
}

function focusAreaFromApi(area: ApiFocusArea): FocusArea {
  return {
    id: area.id,
    title: area.title,
    description: area.description,
    archived: area.archived,
  };
}

export function focusSettingsFromApi(payload: ApiFocusSettings): FocusSettings {
  return {
    focusAreas: payload.focus_areas.map(focusAreaFromApi),
    activeFocusId: payload.active_focus_id,
    updatedAt: payload.updated_at ?? undefined,
  };
}

function focusSettingsToApi(settings: FocusSettings): Omit<ApiFocusSettings, "updated_at"> {
  return {
    focus_areas: settings.focusAreas.map((area) => ({
      id: area.id,
      title: area.title,
      description: area.description,
      archived: area.archived,
    })),
    active_focus_id: settings.activeFocusId,
  };
}

export async function requestGetFocusSettings(): Promise<FocusSettings> {
  const payload = await apiRequest<ApiFocusSettings>("/api/focus-settings/", {
    authenticated: true,
  });
  return focusSettingsFromApi(payload);
}

export async function requestSaveFocusSettings(settings: FocusSettings): Promise<FocusSettings> {
  const payload = await apiRequest<ApiFocusSettings>("/api/focus-settings/", {
    method: "PUT",
    body: JSON.stringify(focusSettingsToApi(settings)),
    authenticated: true,
  });
  return focusSettingsFromApi(payload);
}
