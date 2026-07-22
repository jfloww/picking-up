"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailDrawer({
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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      data-testid="task-detail-drawer"
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex w-96 flex-col gap-1.5 border-l border-border bg-card p-4 shadow-2xl transition-transform duration-200 ease-out",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
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
      <div className="min-h-0 flex-1 overflow-y-auto">
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
    </aside>
  );
}
