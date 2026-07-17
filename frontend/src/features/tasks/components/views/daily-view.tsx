"use client";

import {
  dayLabel,
  dayOfMonth,
  weekdayOf,
  weekStartOf,
  windowAround,
} from "../../lib/dates";
import { DayTimeline } from "../day-timeline";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";
import { DAY_LABELS, type CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const dates = windowAround(anchor);
  const weekStart = weekStartOf(anchor);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{dayLabel(anchor)}</h2>
      <div className="grid grid-cols-[repeat(3,1fr)_2fr_repeat(3,1fr)_1.5fr] gap-1">
        {dates.map((date) => {
          const focused = date === anchor;
          const label = `${DAY_LABELS[weekdayOf(date)]} ${dayOfMonth(date)}`;
          if (focused) {
            return (
              <div
                key={date}
                className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40"
              >
                <div className="mb-1 text-xs font-semibold">{label}</div>
                <DayTimeline date={date} />
              </div>
            );
          }
          return (
            <PeriodCell
              key={date}
              focused={false}
              onFocus={() => onAnchorChange(date)}
              aria-label={label}
              label={label}
              className="min-h-64 p-1.5"
            >
              <ScopeTasks scope={{ kind: "day", date }} compact />
            </PeriodCell>
          );
        })}
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
          <div className="mb-1 text-xs font-semibold">Weekly</div>
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
