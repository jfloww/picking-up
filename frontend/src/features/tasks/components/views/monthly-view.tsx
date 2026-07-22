"use client";

import { monthKeyOf, yearOf } from "../../lib/dates";
import type { CalendarViewProps } from "./weekly-view";
import { YearGrid } from "./year-grid";

export function MonthlyView({ anchor, onAnchorChange, onDrillDown }: CalendarViewProps) {
  const focusedMonth = monthKeyOf(anchor);
  return (
    <YearGrid
      year={yearOf(anchor)}
      focusedMonth={focusedMonth}
      onFocusMonth={(month) => onAnchorChange(`${month}-01`)}
      onDrillDownMonth={
        onDrillDown ? (month) => onDrillDown("weekly", `${month}-01`) : undefined
      }
      sideLabel="Monthly"
      sideScope={{ kind: "month", month: focusedMonth }}
    />
  );
}
