"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";

export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  drawer?: boolean;
}) {
  return (
    <div className={cn("space-y-1", drawer && "space-y-2")}>
      <ul className={cn("space-y-0.5", drawer && "space-y-1")}>
        {subtasks.map((s) => (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2",
              drawer && "gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted/30",
            )}
          >
            <Checkbox
              checked={s.done}
              onCheckedChange={() => onToggle(s.id)}
              aria-label={`Toggle ${s.title}`}
              className={cn(drawer && "border-subtle")}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                drawer && "text-sm",
                s.done && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </span>
            {drawer ? (
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                aria-label={`Delete ${s.title}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-muted hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                aria-label={`Delete ${s.title}`}
                className="text-xs text-subtle hover:text-destructive"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <QuickAdd onAdd={onAdd} placeholder="Add subtask" />
    </div>
  );
}
