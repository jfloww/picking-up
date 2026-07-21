"use client";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div className="space-y-1.5">
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
  );
}
