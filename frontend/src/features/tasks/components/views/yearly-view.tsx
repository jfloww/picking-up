"use client";

import { yearOf } from "../../lib/dates";
import { YearGrid } from "./year-grid";
import type { CalendarViewProps } from "./weekly-view";

export function YearlyView({ anchor }: CalendarViewProps) {
  const year = yearOf(anchor);
  return (
    <YearGrid year={year} sideLabel="Yearly" sideScope={{ kind: "year", year }} />
  );
}
