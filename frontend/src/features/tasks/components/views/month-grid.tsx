"use client";

import { RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayOfMonth, monthGrid, monthKeyOf, todayKey, weekOfYear, weekStartOf } from "../../lib/dates";
import { compareTasksForDay, dayTasksForWeek } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";

export function MonthGrid({
  monthKey,
  selectedDate,
  onSelectDate,
  onDrillDown,
}: {
  monthKey: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onDrillDown?: (view: ViewKind, dateKey: string) => void;
}) {
  const { tasks } = useTasks();
  const today = todayKey();
  const rows = monthGrid(monthKey);

  return (
    <div
      data-testid="month-grid"
      className="flex h-full flex-col divide-y divide-border overflow-hidden rounded-md border border-border"
    >
      {rows.map((row) => {
        const gutterDate = row[0];
        return (
          <div
            key={gutterDate}
            className="grid min-h-24 flex-1 divide-x divide-border"
            style={{ gridTemplateColumns: "2.5rem repeat(7, minmax(0, 1fr))" }}
          >
            <button
              type="button"
              onClick={() => onDrillDown?.("weekly", gutterDate)}
              aria-label={`Open week of ${gutterDate} in Weekly`}
              className="flex items-center justify-center text-[10px] font-medium text-subtle transition-colors hover:text-foreground"
            >
              W{weekOfYear(gutterDate)}&nbsp;›
            </button>
            {row.map((date) => {
              const inMonth = monthKeyOf(date) === monthKey;
              const isToday = date === today;
              const isSelected = date === selectedDate;
              const dayTasks = dayTasksForWeek(tasks, date, weekStartOf(date));
              const active = [...dayTasks.filter((t) => !t.done)].sort(compareTasksForDay);
              const shown = active.slice(0, 2);
              const overflow = active.length - shown.length;

              return (
                <div
                  key={date}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDate(date)}
                  onDoubleClick={() => onDrillDown?.("daily", date)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectDate(date);
                    }
                  }}
                  aria-label={`Open ${date}`}
                  className={cn(
                    "flex min-h-0 cursor-pointer flex-col gap-0.5 p-1.5 text-left",
                    !inMonth && "opacity-50",
                    isSelected && "bg-brand/5 ring-1 ring-inset ring-brand",
                  )}
                >
                  <div className="flex shrink-0 items-center justify-between">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        isToday ? "bg-brand text-primary-foreground" : "text-foreground",
                      )}
                    >
                      {dayOfMonth(date)}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="text-[10px] tabular-nums text-subtle">
                        {dayTasks.length - active.length}/{dayTasks.length}
                      </span>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                    {shown.map((t) => {
                      const overdue = date < today;
                      const pending = date === today;
                      const rolled = !!t.repeatSourceId || !!t.rolledFrom;
                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-1 truncate text-[10px] text-foreground"
                        >
                          {overdue ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                          ) : pending ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
                          ) : rolled ? (
                            <RotateCw className="size-2.5 shrink-0 text-subtle" />
                          ) : (
                            <span className="size-1.5 shrink-0 rounded-full bg-subtle/40" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </div>
                      );
                    })}
                    {overflow > 0 && (
                      <div className="text-[10px] text-subtle">+{overflow} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
