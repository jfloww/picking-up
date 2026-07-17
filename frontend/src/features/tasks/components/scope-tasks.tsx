"use client";

import { cn } from "@/lib/utils";

import { compareTasksForDay } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const key = scopeKey(scope);
  const scoped = tasks.filter((t) => scopeKey(t.scope) === key);
  const ordered =
    scope.kind === "day" ? [...scoped].sort(compareTasksForDay) : scoped;

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {ordered.map((t) => {
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

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {ordered.map((t) => (
          <TaskItem key={t.id} task={t} {...taskItemHandlers(t.id, actions)} />
        ))}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
