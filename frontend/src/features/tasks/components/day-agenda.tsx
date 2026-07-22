"use client";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, isPastToday, nowTime } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
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
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);

  const allDayToDo = dayTasks.filter((t) => !t.time && !t.done);
  const nextUp = [...dayTasks.filter((t) => !!t.time && !t.done)].sort(compareTasksForDay);
  const doneToday = dayTasks.filter((t) => t.done);

  const today = todayKey();
  const isViewingToday = date === today;
  const currentTime = nowTime();

  function renderCard(t: Task, highlight?: "overdue" | "pending") {
    return (
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
            highlight={highlight}
            {...taskItemHandlers(t.id, actions)}
            onSelect={onSelectTask && (() => onSelectTask(t.id))}
          />
        </ul>
      </div>
    );
  }

  return (
    <div ref={agendaZoneRef} data-testid="day-agenda" className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {allDayToDo.length > 0 && (
          <section>
            <div className="mb-1 shrink-0 text-xs font-semibold">All Day To-Do</div>
            <div className="space-y-2">{allDayToDo.map((t) => renderCard(t))}</div>
          </section>
        )}
        {nextUp.length > 0 && (
          <section>
            <div className="mb-1 shrink-0 text-xs font-semibold">Next Up</div>
            <div className="space-y-2">
              {nextUp.map((t) =>
                renderCard(
                  t,
                  isViewingToday
                    ? isPastToday(t.time!, date, today, currentTime)
                      ? "overdue"
                      : "pending"
                    : undefined,
                ),
              )}
            </div>
          </section>
        )}
        {doneToday.length > 0 && (
          <section className="opacity-60">
            <div className="mb-1 shrink-0 text-xs font-semibold">Done Today</div>
            <div className="space-y-2">{doneToday.map((t) => renderCard(t))}</div>
          </section>
        )}
      </div>
      <QuickAdd onAdd={(title) => addTask(title, scope)} />
    </div>
  );
}
