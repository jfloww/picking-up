"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  DAY_LABELS,
  dayOfMonth,
  shortDateLabel,
  todayKey,
  upcomingRepeatDates,
  weekDates,
  weekStartOf,
} from "../../lib/dates";
import { computeOrderBetween } from "../../lib/reorder";
import { dayTasksForWeek, resolveRepeatWeekdays, weekStats } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";
import { ScopeTasks } from "../scope-tasks";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToRescheduleOrReorder } from "../use-drag-to-reschedule-or-reorder";

export interface CalendarViewProps {
  anchor: string;
  onAnchorChange: (dateKey: string) => void;
  onDrillDown?: (view: ViewKind, dateKey: string) => void;
}

const UPCOMING_REPEAT_COUNT = 3;

export function WeeklyView({ anchor, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const weekStart = weekStartOf(anchor);
  const dates = weekDates(weekStart);
  const today = todayKey();
  const { done, total } = weekStats(tasks, weekStart);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));
  const selectedTaskRepeatWeekdays = selectedTask
    ? resolveRepeatWeekdays(selectedTask, tasks)
    : undefined;
  const selectedTaskUpcomingRepeatDates = selectedTaskRepeatWeekdays
    ? upcomingRepeatDates(selectedTaskRepeatWeekdays, today, UPCOMING_REPEAT_COUNT).map((date) =>
        shortDateLabel(date, today),
      )
    : undefined;

  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const orderedIdsByDate: Record<string, string[]> = {};
  for (const date of dates) {
    orderedIdsByDate[date] = [...dayTasksForWeek(tasks, date, weekStart)]
      .filter((t) => !t.time)
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id);
  }
  const { dragState, getDragHandlers } = useDragToRescheduleOrReorder({
    columnRefs,
    itemRefs,
    orderedIdsByDate,
    onReorder: (id, insertBeforeId, sourceDate) => {
      const ids = orderedIdsByDate[sourceDate] ?? [];
      const remaining = ids.filter((taskId) => taskId !== id);
      const targetIndex =
        insertBeforeId === null ? remaining.length : remaining.indexOf(insertBeforeId);
      if (targetIndex === -1) return;
      const byId = (taskId: string) => tasks.find((t) => t.id === taskId);
      const before = targetIndex > 0 ? byId(remaining[targetIndex - 1])?.order : undefined;
      const after =
        targetIndex < remaining.length ? byId(remaining[targetIndex])?.order : undefined;
      const dragged = byId(id);
      if (!dragged) return;
      const newOrder = computeOrderBetween(before, after);
      if (newOrder === dragged.order) return;
      actions.setOrder(id, newOrder);
    },
    onReschedule: (id, date) => actions.rescheduleTaskToDay(id, date),
  });

  return (
    <div
      data-testid="weekly-view"
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 transition-[padding-right] duration-200 ease-out",
        selectedTask && "pr-[400px]",
      )}
    >
      <div className="shrink-0 rounded-md bg-muted/40 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
          This Week
        </div>
        <div className="flex items-center gap-4">
          <div>
            <span className="text-2xl font-bold tabular-nums">{done}</span>
            <span className="text-sm text-subtle">/{total}</span>
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          upcomingRepeatDates={selectedTaskUpcomingRepeatDates}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1.5">
        {dates.map((date, i) => {
          const dayTasks = dayTasksForWeek(tasks, date, weekStart);
          const dayDone = dayTasks.filter((t) => t.done).length;
          const isDropTarget =
            dragState?.resolution.kind === "reschedule" && dragState.resolution.date === date;
          return (
            <div
              key={date}
              data-testid={`day-column-${date}`}
              ref={(el) => {
                columnRefs.current[date] = el;
              }}
              className={cn(
                "flex min-h-0 flex-col rounded-md bg-card p-1.5 ring-1 ring-ring/40 transition-colors",
                isDropTarget && "bg-brand/5 ring-2 ring-brand",
              )}
            >
              <div className="mb-1 flex shrink-0 items-center justify-between">
                <button
                  type="button"
                  onDoubleClick={() => onDrillDown?.("daily", date)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDrillDown?.("daily", date);
                    }
                  }}
                  aria-label={`Go to ${date}`}
                  className={cn(
                    "text-left text-xs font-semibold",
                    date === today ? "text-brand" : "text-subtle",
                  )}
                >
                  {DAY_LABELS[i]} {dayOfMonth(date)}
                </button>
                <span className="text-[10px] tabular-nums text-subtle">
                  {dayDone}/{dayTasks.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ScopeTasks
                  scope={{ kind: "day", date }}
                  quickAdd
                  onSelectTask={handleSelectTask}
                  highlightOverdue
                  showRepeatLabel
                  getDragHandlers={getDragHandlers}
                  itemRefs={itemRefs}
                />
              </div>
            </div>
          );
        })}
      </div>

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: dragState.pointerX + 12,
          }}
        >
          {dragState.title}
        </div>
      )}
    </div>
  );
}
