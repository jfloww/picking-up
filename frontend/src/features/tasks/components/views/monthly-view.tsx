"use client";

import { useState } from "react";

import { monthKeyOf } from "../../lib/dates";
import { monthStats } from "../../lib/times";
import { useTasks } from "../../store";
import { DayAgendaDrawer } from "../day-agenda-drawer";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { MonthGrid } from "./month-grid";
import type { CalendarViewProps } from "./weekly-view";

type Overlay = { type: "day"; date: string } | { type: "task"; taskId: string; fromDate: string };

export function MonthlyView({ anchor, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const monthKey = monthKeyOf(anchor);
  const { done, total } = monthStats(tasks, monthKey);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const selectedDate =
    overlay?.type === "day" ? overlay.date : overlay?.type === "task" ? overlay.fromDate : null;
  const selectedTask =
    overlay?.type === "task" ? (tasks.find((t) => t.id === overlay.taskId) ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <div className="shrink-0 rounded-md bg-muted/40 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
          This Month
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

      <div className="min-h-0 flex-1">
        <MonthGrid
          monthKey={monthKey}
          selectedDate={selectedDate}
          onSelectDate={(date) => setOverlay({ type: "day", date })}
          onDrillDown={onDrillDown}
        />
      </div>

      {overlay?.type === "day" && (
        <DayAgendaDrawer
          date={overlay.date}
          onClose={() => setOverlay(null)}
          onOpenDaily={() => onDrillDown?.("daily", overlay.date)}
          onSelectTask={(taskId) => setOverlay({ type: "task", taskId, fromDate: overlay.date })}
        />
      )}

      {selectedTask && overlay?.type === "task" && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setOverlay({ type: "day", date: overlay.fromDate })}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}
