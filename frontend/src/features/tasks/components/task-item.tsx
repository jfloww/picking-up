"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
}

// Builds TaskItem's callback props from store actions; shared by ScopeTasks
// and DayTimeline so the wiring lives in one place.
export function taskItemHandlers(id: string, actions: TaskItemActions) {
  return {
    onToggle: () => actions.toggleTask(id),
    onMemoChange: (memo: string) => actions.setMemo(id, memo),
    onTimeChange: (time?: string) => actions.setTime(id, time),
    onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}

export function TaskItem({
  task,
  dateLabel,
  highlight,
  repeatLabel,
  size = "default",
  onToggle,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onSelect,
}: {
  task: Task;
  dateLabel?: string;
  highlight?: "overdue" | "pending";
  repeatLabel?: string;
  size?: "default" | "large";
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;
  const large = size === "large";

  const timeBadge = task.time && (
    <span
      className={cn("shrink-0 tabular-nums text-subtle", large ? "text-sm" : "text-xs")}
    >
      {task.time}
    </span>
  );

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md",
          large ? "bg-card p-3 ring-1 ring-border/60" : "py-1.5",
          highlight === "overdue" && "border-l-2 border-destructive bg-destructive/10 pl-1.5",
          highlight === "pending" && "border-l-2 border-warning bg-warning/10 pl-1.5",
        )}
      >
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
          className={large ? "size-5" : undefined}
        />
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
        {!large && timeBadge}
        <button
          type="button"
          onClick={() => (onSelect ? onSelect() : setOpen((o) => !o))}
          className={cn(
            "min-w-0 flex-1 truncate text-left font-medium",
            large ? "text-2xl font-semibold" : "text-base",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
        {large && timeBadge}
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className={cn(
              "shrink-0 rounded bg-muted tabular-nums text-muted-foreground",
              large ? "px-1.5 text-xs" : "px-1 text-[10px]",
            )}
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {repeatLabel && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-xs" : "px-1 text-[10px]",
            )}
          >
            {repeatLabel}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw
            aria-label="Rolled over"
            className={cn("shrink-0 text-subtle", large ? "size-4" : "size-3")}
          />
        )}
      </div>
      {open && (
        <div className="mt-1 pl-6">
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
        </div>
      )}
    </li>
  );
}
