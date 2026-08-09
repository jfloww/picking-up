"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { monthKeyOf, shortDateLabel, todayKey, upcomingRepeatDates } from "../../lib/dates";
import { monthStats, resolveRepeatWeekdays } from "../../lib/times";
import { useTasks } from "../../store";
import { DayAgendaDrawer } from "../day-agenda-drawer";
import { QuickAdd } from "../quick-add";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { MonthGrid } from "./month-grid";
import type { CalendarViewProps } from "./weekly-view";

type Overlay = { type: "day"; date: string } | { type: "task"; taskId: string; fromDate: string };

const UPCOMING_REPEAT_COUNT = 3;

export function MonthlyView({ anchor, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const monthKey = monthKeyOf(anchor);
  const today = todayKey();
  const { done, total } = monthStats(tasks, monthKey);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const mobileQuickAddDate = monthKeyOf(today) === monthKey ? today : `${monthKey}-01`;

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const selectedDate =
    overlay?.type === "day" ? overlay.date : overlay?.type === "task" ? overlay.fromDate : null;
  const selectedTask =
    overlay?.type === "task" ? (tasks.find((t) => t.id === overlay.taskId) ?? null) : null;
  const selectedTaskRepeatWeekdays = selectedTask
    ? resolveRepeatWeekdays(selectedTask, tasks)
    : undefined;
  const selectedTaskUpcomingRepeatDates = selectedTaskRepeatWeekdays
    ? upcomingRepeatDates(selectedTaskRepeatWeekdays, today, UPCOMING_REPEAT_COUNT).map((date) =>
        shortDateLabel(date, today),
      )
    : undefined;

  // When a task is deleted while its TaskDetailDrawer is open, `selectedTask`
  // resolves to null but `overlay` is still `{ type: "task" }` — fall back to
  // showing the day-agenda drawer for that task's date instead of no overlay.
  const showDayAgenda =
    overlay?.type === "day" || (overlay?.type === "task" && !selectedTask);
  const dayAgendaDate = overlay?.type === "day" ? overlay.date : overlay?.type === "task" ? overlay.fromDate : null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 overflow-hidden transition-[padding-right] duration-200 ease-out",
        overlay && "sm:pr-[400px]",
      )}
    >
      <div className="mx-4 shrink-0 rounded-xl bg-muted/50 p-3 sm:mx-0 sm:rounded-md sm:bg-muted/40">
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

      <div className="shrink-0 border-t border-border bg-card px-4 py-2 sm:hidden">
        <QuickAdd
          onAdd={(title) => actions.addTask(title, { kind: "day", date: mobileQuickAddDate })}
          onAddAndOpen={(title) => {
            const created = actions.addTask(title, { kind: "day", date: mobileQuickAddDate });
            if (created) {
              setOverlay({ type: "task", taskId: created.id, fromDate: mobileQuickAddDate });
            }
          }}
          placeholder={`New task for ${shortDateLabel(mobileQuickAddDate, today)}`}
          ariaLabel={`Add task for ${shortDateLabel(mobileQuickAddDate, today)}`}
          variant="panel-footer"
        />
      </div>

      {showDayAgenda && dayAgendaDate && (
        <DayAgendaDrawer
          date={dayAgendaDate}
          onClose={() => setOverlay(null)}
          onOpenDaily={() => onDrillDown?.("daily", dayAgendaDate)}
          onSelectTask={(taskId) => setOverlay({ type: "task", taskId, fromDate: dayAgendaDate })}
        />
      )}

      {selectedTask && overlay?.type === "task" && (
        <TaskDetailDrawer
          task={selectedTask}
          upcomingRepeatDates={selectedTaskUpcomingRepeatDates}
          onClose={() => setOverlay({ type: "day", date: overlay.fromDate })}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}
