"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { dayTasksForWeek, resolveRepeatWeekdays, weekStats } from "../../lib/times";
import { useTasks } from "../../store";
import type { ViewKind } from "../view-switcher";
import { QuickAdd } from "../quick-add";
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

export function WeeklyView({ anchor, onAnchorChange, onDrillDown }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const weekStart = weekStartOf(anchor);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const today = todayKey();
  const { done, total } = weekStats(tasks, weekStart);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const [mobileQuickAddDate, setMobileQuickAddDate] = useState(anchor);

  useEffect(() => setMobileQuickAddDate(anchor), [anchor]);

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
  // Memoized so it keeps a stable identity across the re-renders an active
  // drag causes (every pointermove sets drag state). It's a dependency of
  // the hook's internal `resolve`/`getDragHandlers` useCallbacks, so
  // rebuilding it each render would recreate those on every pointermove and
  // negate their memoization entirely.
  const orderedIdsByDate = useMemo(() => {
    const byDate: Record<string, string[]> = {};
    for (const date of dates) {
      byDate[date] = [...dayTasksForWeek(tasks, date, weekStart)]
        .filter((t) => !t.time)
        .sort((a, b) => a.order - b.order)
        .map((t) => t.id);
    }
    return byDate;
  }, [tasks, dates, weekStart]);
  const { dragState, getDragHandlers } = useDragToRescheduleOrReorder({
    columnRefs,
    itemRefs,
    orderedIdsByDate,
    onReorder: (id, insertBeforeId, sourceDate) => {
      const ids = orderedIdsByDate[sourceDate] ?? [];
      const currentIndex = ids.indexOf(id);
      if (currentIndex === -1) return;
      const remaining = ids.filter((taskId) => taskId !== id);
      const targetIndex =
        insertBeforeId === null ? remaining.length : remaining.indexOf(insertBeforeId);
      if (targetIndex === -1) return;
      // Compare list *positions*, not just a resolved order value: the
      // dragged id currently sits at currentIndex within `ids` (itself
      // still present). Removing it to build `remaining` shifts every
      // later index down by one, so the slot it already occupies is
      // targetIndex === currentIndex in `remaining`'s index space — e.g.
      // dropping it directly above its current next-neighbor recomputes
      // the same position even though insertBeforeId names a *different*
      // neighbor than "itself". Catching that here (rather than only
      // `id === insertBeforeId`) avoids a visually-no-op drag firing a
      // real reorderTask and its network write — the server has no cheap
      // way to detect "this would be a no-op" itself without first doing
      // the same work the client just did.
      if (targetIndex === currentIndex) return;
      actions.reorderTask(id, insertBeforeId);
    },
    onReschedule: (id, date) => actions.rescheduleTaskToDay(id, date),
  });

  return (
    <div
      data-testid="weekly-view"
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 transition-[padding-right] duration-200 ease-out",
        selectedTask && "sm:pr-[400px]",
      )}
    >
      <div className="mx-4 shrink-0 rounded-xl bg-muted/50 p-3 sm:mx-0 sm:rounded-md sm:bg-muted/40">
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

      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-2 overflow-y-auto px-4 pb-2 sm:auto-rows-auto sm:grid-cols-7 sm:gap-1.5 sm:overflow-hidden sm:px-px sm:pb-0">
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
                "flex min-h-fit flex-col rounded-xl bg-card p-3 ring-1 ring-ring/40 transition-colors sm:min-h-0 sm:rounded-md sm:p-1.5",
                isDropTarget && "bg-brand/5 ring-2 ring-brand",
                mobileQuickAddDate === date && "bg-brand/5 sm:bg-card",
              )}
            >
              <div className="mb-2 flex shrink-0 items-center justify-between sm:mb-1">
                <button
                  type="button"
                  onClick={() => {
                    setMobileQuickAddDate(date);
                    onAnchorChange(date);
                  }}
                  onDoubleClick={() => onDrillDown?.("daily", date)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDrillDown?.("daily", date);
                    }
                  }}
                  aria-label={`Go to ${date}`}
                  className={cn(
                    "min-h-11 text-left text-sm font-semibold sm:min-h-0 sm:text-xs",
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
                  quickAddClassName="hidden sm:block"
                  onSelectTask={handleSelectTask}
                  highlightOverdue
                  showRepeatLabel
                  size="week"
                  getDragHandlers={getDragHandlers}
                  itemRefs={itemRefs}
                  dragState={dragState}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 py-2 sm:hidden">
        <QuickAdd
          onAdd={(title) => actions.addTask(title, { kind: "day", date: mobileQuickAddDate })}
          onAddAndOpen={(title) => {
            const created = actions.addTask(title, { kind: "day", date: mobileQuickAddDate });
            if (created) handleSelectTask(created.id);
          }}
          placeholder={`New task for ${shortDateLabel(mobileQuickAddDate, today)}`}
          ariaLabel={`Add task for ${shortDateLabel(mobileQuickAddDate, today)}`}
          variant="panel-footer"
        />
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
