"use client";

import { compareTasksForDay } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

type GetDragHandlers = (
  id: string,
  title: string,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

export function DayAgenda({
  date,
  onSelectTask,
  agendaZoneRef,
  getDragHandlers,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  agendaZoneRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = [...tasks.filter((t) => scopeKey(t.scope) === key)].sort(compareTasksForDay);

  return (
    <div ref={agendaZoneRef} data-testid="day-agenda" className="flex h-full flex-col">
      <div className="mb-1 shrink-0 text-xs font-semibold">All day</div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {dayTasks.map((t) => (
          <div
            key={t.id}
            data-testid={`agenda-${t.id}`}
            className="touch-none"
            {...getDragHandlers(t.id, t.title)}
          >
            <ul>
              <TaskItem
                task={t}
                size="large"
                {...taskItemHandlers(t.id, actions)}
                onSelect={onSelectTask && (() => onSelectTask(t.id))}
              />
            </ul>
          </div>
        ))}
      </div>
      <QuickAdd onAdd={(title) => addTask(title, scope)} />
    </div>
  );
}
