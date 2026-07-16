"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";

export function TaskItem({
  task,
  onToggle,
  onMemoChange,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-1 pl-6">
          <textarea
            defaultValue={task.memo ?? ""}
            onBlur={(e) => onMemoChange(e.target.value)}
            placeholder="Memo"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-destructive hover:underline"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
