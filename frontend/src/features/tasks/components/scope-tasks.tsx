"use client";

import { cn } from "@/lib/utils";

import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem } from "./task-item";

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
}) {
  const { tasks, addTask, toggleTask, setMemo, removeTask } = useTasks();
  const key = scopeKey(scope);
  const scoped = tasks.filter((t) => scopeKey(t.scope) === key);

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {scoped.map((t) => (
          <li
            key={t.id}
            className={cn(
              "truncate text-xs text-muted-foreground",
              t.done && "line-through opacity-60",
            )}
          >
            {t.title}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {scoped.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            onToggle={() => toggleTask(t.id)}
            onMemoChange={(memo) => setMemo(t.id, memo)}
            onDelete={() => removeTask(t.id)}
          />
        ))}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
