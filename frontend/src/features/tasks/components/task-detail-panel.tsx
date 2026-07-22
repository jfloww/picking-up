"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailPanel({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto rounded-md border border-border/60 p-1.5">
      <div className="flex items-center gap-2" data-testid="task-detail-header">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <TaskTimeEditor time={task.time} onTimeChange={onTimeChange} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 text-subtle hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <TaskDetailFields
        task={task}
        onMemoChange={onMemoChange}
        onTimeChange={onTimeChange}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        onPriorityChange={onPriorityChange}
        onDelete={onDelete}
        onAddSubtask={onAddSubtask}
        onToggleSubtask={onToggleSubtask}
        onRemoveSubtask={onRemoveSubtask}
        showTime={false}
      />
    </div>
  );
}
