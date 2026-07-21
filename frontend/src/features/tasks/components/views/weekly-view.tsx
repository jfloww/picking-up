"use client";

import { cn } from "@/lib/utils";

import {
  dayOfMonth,
  monthGrid,
  monthKeyOf,
  todayKey,
  weekStartOf,
} from "../../lib/dates";
import type { Scope } from "../../types";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";

export interface CalendarViewProps {
  anchor: string;
  onAnchorChange: (dateKey: string) => void;
}

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function WeeklyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const monthKey = monthKeyOf(anchor);
  const grid = monthGrid(monthKey);
  const focusedWeek = weekStartOf(anchor);
  const today = todayKey();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-8 gap-1 px-1 text-xs font-medium text-subtle">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-1.5">
            {d}
          </div>
        ))}
        <div className="px-1.5">Weekly</div>
      </div>
      <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {grid.map((row) => {
          const firstDate = row.find((d): d is string => d !== null)!;
          const weekStart = weekStartOf(firstDate);
          const focused = weekStart === focusedWeek;
          const weekScope: Scope = { kind: "week", weekStart };
          const cellHeight = focused ? "h-28" : "h-12";

          return (
            <PeriodCell
              key={weekStart}
              focused={focused}
              onFocus={() => onAnchorChange(firstDate)}
              aria-label={`Week of ${firstDate}`}
              className="p-1"
              contentClassName="grid grid-cols-8 gap-1"
            >
              {row.map((date, i) =>
                date ? (
                  <div
                    key={date}
                    className={cn(
                      "flex flex-col rounded-md p-1.5",
                      cellHeight,
                    )}
                  >
                    <div
                      className={cn(
                        "shrink-0 text-xs",
                        date === today ? "font-bold text-brand" : "text-subtle",
                      )}
                    >
                      {dayOfMonth(date)}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <ScopeTasks
                        scope={{ kind: "day", date }}
                        quickAdd={focused}
                        compact={!focused}
                      />
                    </div>
                  </div>
                ) : (
                  <div key={`empty-${i}`} className={cn("p-1.5", cellHeight)} />
                ),
              )}
              <div
                className={cn(
                  "flex flex-col rounded-md bg-muted/40 p-1.5",
                  cellHeight,
                )}
              >
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ScopeTasks
                    scope={weekScope}
                    quickAdd={focused}
                    compact={!focused}
                  />
                </div>
              </div>
            </PeriodCell>
          );
        })}
      </div>
    </div>
  );
}
