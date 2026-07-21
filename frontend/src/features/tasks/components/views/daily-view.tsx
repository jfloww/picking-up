"use client";

import { weekStartOf } from "../../lib/dates";
import { DayTimeline } from "../day-timeline";
import { ScopeTasks } from "../scope-tasks";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);

  return (
    <div className="grid h-full grid-cols-2 gap-1.5">
      <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
        <DayTimeline date={anchor} />
      </div>
      <div className="flex min-h-64 flex-col rounded-md bg-muted/40 p-1.5">
        <div className="mb-1 shrink-0 text-xs font-semibold">Weekly</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
