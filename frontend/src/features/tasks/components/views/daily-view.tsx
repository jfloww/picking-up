"use client";

import { useRef, useState } from "react";

import { todayKey, shortDateLabel, upcomingRepeatDates } from "../../lib/dates";
import { resolveRepeatWeekdays } from "../../lib/times";
import { useTasks } from "../../store";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToSchedule } from "../use-drag-to-schedule";
import type { CalendarViewProps } from "./weekly-view";

const UPCOMING_REPEAT_COUNT = 3;

export function DailyView({ anchor }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks, setTime } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedTaskRepeatWeekdays = selectedTask
    ? resolveRepeatWeekdays(selectedTask, tasks)
    : undefined;
  const selectedTaskUpcomingRepeatDates = selectedTaskRepeatWeekdays
    ? upcomingRepeatDates(selectedTaskRepeatWeekdays, todayKey(), UPCOMING_REPEAT_COUNT).map(
        (date) => shortDateLabel(date, todayKey()),
      )
    : undefined;

  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));

  const railRef = useRef<HTMLDivElement>(null);
  const agendaZoneRef = useRef<HTMLDivElement>(null);
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef: agendaZoneRef,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
  });

  return (
    <>
      <div
        data-testid="daily-layout"
        className="grid h-full min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] overflow-hidden bg-background"
      >
        <section
          data-testid="timeline-panel"
          aria-label="Daily timeline"
          className="min-h-0 min-w-0 border-r border-border bg-background"
        >
          <DayTimeline
            date={anchor}
            onSelectTask={handleSelectTask}
            railRef={railRef}
            getDragHandlers={getDragHandlers}
            dragState={dragState}
          />
        </section>
        <aside
          data-testid="agenda-panel"
          aria-label="Daily task list"
          className="min-h-0 min-w-0 bg-card/50"
        >
          <DayAgenda
            date={anchor}
            onSelectTask={handleSelectTask}
            agendaZoneRef={agendaZoneRef}
            getDragHandlers={getDragHandlers}
          />
        </aside>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          upcomingRepeatDates={selectedTaskUpcomingRepeatDates}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}

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
    </>
  );
}
