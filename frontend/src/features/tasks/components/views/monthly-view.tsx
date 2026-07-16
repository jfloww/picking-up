"use client";

import { monthKeyOf, yearOf } from "../../lib/dates";
import { YearGrid } from "./year-grid";
import type { CalendarViewProps } from "./weekly-view";

export function MonthlyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const focusedMonth = monthKeyOf(anchor);
  return (
    <YearGrid
      year={yearOf(anchor)}
      focusedMonth={focusedMonth}
      onFocusMonth={(month) => onAnchorChange(`${month}-01`)}
      sideLabel="Monthly"
      sideScope={{ kind: "month", month: focusedMonth }}
    />
  );
}
