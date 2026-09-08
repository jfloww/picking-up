export interface FocusArea {
  id: string;
  title: string;
  description: string;
  archived: boolean;
}

export interface FocusSettings {
  focusAreas: FocusArea[];
  activeFocusId: string | null;
  updatedAt?: string;
}

export const EMPTY_FOCUS_SETTINGS: FocusSettings = {
  focusAreas: [],
  activeFocusId: null,
};

export const MAX_FOCUS_AREAS = 12;
