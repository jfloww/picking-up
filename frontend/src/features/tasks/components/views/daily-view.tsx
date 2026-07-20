"use client";

import { dayLabel, weekStartOf } from "../../lib/dates";
import { DayTimeline } from "../day-timeline";
import { ScopeTasks } from "../scope-tasks";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{dayLabel(anchor)}</h2>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
          <DayTimeline date={anchor} />
        </div>
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
          <div className="mb-1 text-xs font-semibold">Weekly</div>
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
