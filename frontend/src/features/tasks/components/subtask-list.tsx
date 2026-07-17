"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";

export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
}) {
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <Checkbox
              checked={s.done}
              onCheckedChange={() => onToggle(s.id)}
              aria-label={`Toggle ${s.title}`}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                s.done && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </span>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              aria-label={`Delete ${s.title}`}
              className="text-xs text-subtle hover:text-destructive"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <QuickAdd onAdd={onAdd} placeholder="Add subtask" />
    </div>
  );
}
