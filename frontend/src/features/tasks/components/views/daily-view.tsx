"use client";

import { useRef, useState } from "react";

import { useTasks } from "../../store";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToSchedule } from "../use-drag-to-schedule";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks, setTime } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

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
      <div className="grid h-full grid-cols-[3fr_2fr] gap-1.5">
        <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
          <DayTimeline
            date={anchor}
            onSelectTask={handleSelectTask}
            railRef={railRef}
            getDragHandlers={getDragHandlers}
            dragState={dragState}
          />
        </div>
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
          <DayAgenda
            date={anchor}
            onSelectTask={handleSelectTask}
            agendaZoneRef={agendaZoneRef}
            getDragHandlers={getDragHandlers}
          />
        </div>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
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
