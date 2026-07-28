"use client";

import { cn } from "@/lib/utils";

import { shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
import { compareTasksForDay, dayTasksForWeek, repeatLabelForTask, weeklyRollupTasks } from "../lib/times";
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

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
  onSelectTask,
  highlightOverdue = false,
  showRepeatLabel = false,
  getDragHandlers,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
  onSelectTask?: (id: string) => void;
  highlightOverdue?: boolean;
  showRepeatLabel?: boolean;
  getDragHandlers?: GetDragHandlers;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;

  let items: { task: Task; date: string | null }[];
  if (scope.kind === "week") {
    items = weeklyRollupTasks(tasks, scope.weekStart);
  } else if (scope.kind === "day" && highlightOverdue) {
    const scoped = dayTasksForWeek(tasks, scope.date, weekStartOf(scope.date));
    items = [...scoped].sort(compareTasksForDay).map((task) => ({ task, date: null }));
  } else {
    const key = scopeKey(scope);
    const scoped = tasks.filter((t) => scopeKey(t.scope) === key);
    const ordered =
      scope.kind === "day" ? [...scoped].sort(compareTasksForDay) : scoped;
    items = ordered.map((task) => ({ task, date: null }));
  }

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {items.map(({ task: t }) => {
          const subtasks = t.subtasks ?? [];
          const doneCount = subtasks.filter((s) => s.done).length;
          return (
            <li
              key={t.id}
              className={cn(
                "truncate text-xs text-muted-foreground",
                t.done && "line-through opacity-60",
              )}
            >
              {t.time && <span className="tabular-nums">{t.time} · </span>}
              {t.title}
              {subtasks.length > 0 && (
                <span className="tabular-nums"> · {doneCount}/{subtasks.length}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const today = todayKey();
  const dayDate = scope.kind === "day" ? scope.date : null;

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {items.map(({ task: t, date }) => {
          let highlight: "overdue" | "pending" | undefined;
          if (highlightOverdue && dayDate && !t.done) {
            if (dayDate < today) highlight = "overdue";
            else if (dayDate === today) highlight = "pending";
          }
          const taskItem = (
            <TaskItem
              key={t.id}
              task={t}
              dateLabel={date ? shortDateLabel(date, today) : undefined}
              highlight={highlight}
              repeatLabel={showRepeatLabel ? repeatLabelForTask(t, tasks) : undefined}
              onSelect={onSelectTask ? () => onSelectTask(t.id) : undefined}
              {...taskItemHandlers(t.id, actions)}
            />
          );
          if (!getDragHandlers) return taskItem;
          return (
            <li key={t.id} className="touch-none" {...getDragHandlers(t.id, t.title)}>
              <ul>{taskItem}</ul>
            </li>
          );
        })}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
