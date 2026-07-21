"use client";

import { useState } from "react";

import { ShrinkStack } from "@/components/shrink-stack";

import { weekStartOf } from "../../lib/dates";
import { useTasks } from "../../store";
import { DayTimeline } from "../day-timeline";
import { ScopeTasks } from "../scope-tasks";
import { taskItemHandlers } from "../task-item";
import { TaskDetailPanel } from "../task-detail-panel";
import type { CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);
  const actions = useTasks();
  const { tasks } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));

  const weeklyList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 shrink-0 text-xs font-semibold">Weekly</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
      </div>
    </div>
  );

  return (
    <div className="grid h-full grid-cols-2 gap-1.5">
      <div className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40">
        <DayTimeline date={anchor} onSelectTask={handleSelectTask} />
      </div>
      <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
        {selectedTask ? (
          <ShrinkStack
            primary={weeklyList}
            primaryMinHeight={200}
            secondary={
              <TaskDetailPanel
                task={selectedTask}
                onClose={() => setSelectedTaskId(null)}
                {...taskItemHandlers(selectedTask.id, actions)}
              />
            }
          />
        ) : (
          weeklyList
        )}
      </div>
    </div>
  );
}
