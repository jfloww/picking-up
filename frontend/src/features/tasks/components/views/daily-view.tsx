"use client";

import {
  dayOfMonth,
  monthKeyOf,
  monthLabel,
  weekDates,
  weekStartOf,
} from "../../lib/dates";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";
import { DAY_LABELS, type CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);
  const dates = weekDates(weekStart);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">
        {monthLabel(monthKeyOf(anchor))}
      </h2>
      <div className="grid grid-cols-8 gap-1">
        {dates.map((date, i) => {
          const focused = date === anchor;
          const label = `${DAY_LABELS[i]} ${dayOfMonth(date)}`;
          return (
            <PeriodCell
              key={date}
              focused={focused}
              onFocus={() => onAnchorChange(date)}
              aria-label={label}
              label={label}
              className="min-h-40 p-1.5"
            >
              <ScopeTasks
                scope={{ kind: "day", date }}
                quickAdd={focused}
                compact={!focused}
              />
            </PeriodCell>
          );
        })}
        <div className="min-h-40 rounded-md bg-muted/40 p-1.5">
          <div className="mb-1 text-xs font-semibold">Weekly</div>
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
