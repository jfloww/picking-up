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
    <div
      ref={agendaZoneRef}
      data-testid="day-agenda"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card/50"
    >
      <div
        data-testid="day-agenda-scroll"
        className="min-h-0 flex-1 space-y-10 overflow-y-auto p-10"
      >
        {allDayToDo.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                All Day To-Do
              </h3>
              <span
                aria-label={`All Day To-Do: ${allDayToDo.length}`}
                className="text-xs font-semibold tabular-nums text-brand"
              >
                {allDayToDo.length}
              </span>
            </div>
            <div className="space-y-3">{allDayToDo.map((t) => renderCard(t))}</div>
          </section>
        )}
        {nextUp.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Next Up
              </h3>
            </div>
            <div className="space-y-3">
              {nextUp.map((t) =>
                renderCard(
                  t,
                  isViewingToday
                    ? isPastToday(t.time!, date, today, currentTime, t.durationMinutes)
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
            <div className="mb-4 flex shrink-0 items-center gap-3">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Done Today
              </h3>
            </div>
            <div className="space-y-3">{doneToday.map((t) => renderCard(t))}</div>
          </section>
        )}
      </div>
      <div
        data-testid="day-agenda-footer"
        className="shrink-0 border-t border-border bg-card p-6"
      >
        <QuickAdd
          onAdd={(title) => addTask(title, scope)}
          onAddAndOpen={
            onSelectTask &&
            ((title) => {
              const created = addTask(title, scope);
              if (created) onSelectTask(created.id);
            })
          }
          placeholder="New task"
          ariaLabel="Add task"
          variant="panel-footer"
        />
      </div>
    </div>
  );
}
