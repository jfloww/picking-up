"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
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
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}

export function TaskItem({
  task,
  dateLabel,
  onToggle,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  dateLabel?: string;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <li>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
        {task.time && (
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {task.time}
          </span>
        )}
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
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground"
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-1.5 pl-6">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={task.time ?? ""}
              onChange={(e) => onTimeChange(e.target.value || undefined)}
              aria-label="Task time"
              className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            {task.time && (
              <button
                type="button"
                onClick={() => onTimeChange(undefined)}
                className="text-xs text-subtle hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
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
      )}
    </li>
  );
}
