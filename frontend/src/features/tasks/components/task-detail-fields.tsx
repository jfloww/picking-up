"use client";

import { RotateCw, Star } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskRepeatPicker } from "./task-repeat-picker";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  showTime = true,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  showTime?: boolean;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div className="space-y-1.5">
      {showTime && <TaskTimeEditor time={task.time} onTimeChange={onTimeChange} />}
      {(task.repeatWeekdays !== undefined || task.scope.kind === "day") &&
        (task.repeatSourceId !== undefined ? (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <RotateCw aria-label="Part of a routine" className="size-3" />
            Part of a routine
          </span>
        ) : (
          <TaskRepeatPicker
            weekdays={task.repeatWeekdays ?? []}
            onChange={onRepeatWeekdaysChange}
          />
        ))}
      <button
        type="button"
        onClick={() => onPriorityChange(!task.priority)}
        aria-pressed={!!task.priority}
        className={cn(
          "flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
          task.priority
            ? "bg-muted text-foreground"
            : "bg-transparent text-subtle hover:bg-muted/50",
        )}
      >
        <Star className={cn("size-3", task.priority && "fill-current")} />
        Priority
      </button>
      <textarea
        defaultValue={task.memo ?? ""}
        onBlur={(e) => onMemoChange(e.target.value)}
        placeholder="Memo"
        rows={2}
        className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
      />
      <button
        type="button"
        onClick={onDelete}
        className="text-xs text-destructive hover:underline"
      >
        Delete
      </button>
    </div>
  );
}
