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
  onDurationChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  showTime = true,
  showDelete = true,
  variant = "default",
  upcomingRepeatDates,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  showTime?: boolean;
  showDelete?: boolean;
  variant?: "default" | "drawer";
  upcomingRepeatDates?: string[];
}) {
  const subtasks = task.subtasks ?? [];
  const drawer = variant === "drawer";
  const showRepeat = task.repeatWeekdays !== undefined || task.scope.kind === "day";

  return (
    <div className={cn(drawer ? "space-y-7" : "space-y-1.5")}>
      {showTime && (
        <TaskTimeEditor
          time={task.time}
          onTimeChange={onTimeChange}
          durationMinutes={task.durationMinutes}
          onDurationChange={onDurationChange}
        />
      )}
      {showRepeat && (
        <section className={cn(drawer && "space-y-3")}>
          {drawer && (
            <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
              Repeat
            </h4>
          )}
          {task.repeatSourceId !== undefined ? (
            <span className="flex items-center gap-1 text-xs text-subtle">
              <RotateCw aria-label="Part of a routine" className="size-3" />
              Part of a routine
            </span>
          ) : (
            <TaskRepeatPicker
              weekdays={task.repeatWeekdays ?? []}
              onChange={onRepeatWeekdaysChange}
            />
          )}
          {upcomingRepeatDates && upcomingRepeatDates.length > 0 && (
            <p className="text-[11px] text-subtle">
              Next: {upcomingRepeatDates.join(", ")}
            </p>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => onPriorityChange(!task.priority)}
        aria-pressed={!!task.priority}
        className={cn(
          "flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
          task.priority
            ? "bg-muted text-foreground"
            : "bg-transparent text-subtle hover:bg-muted/50",
          drawer && "px-3 py-2",
        )}
      >
        <Star className={cn("size-3", task.priority && "fill-current")} />
        Priority
      </button>

      <section className={cn(drawer && "space-y-3")}>
        {drawer && (
          <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
            Notes
          </h4>
        )}
        <textarea
          defaultValue={task.memo ?? ""}
          onBlur={(e) => onMemoChange(e.target.value)}
          placeholder="Memo"
          rows={drawer ? 5 : 2}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "rounded-lg bg-muted/30 p-3 text-sm leading-relaxed",
          )}
        />
      </section>

      <section className={cn(drawer && "space-y-3 border-t border-border pt-7")}>
        {drawer && (
          <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
            Subtasks
          </h4>
        )}
        <SubtaskList
          subtasks={subtasks}
          onAdd={onAddSubtask}
          onToggle={onToggleSubtask}
          onRemove={onRemoveSubtask}
        />
      </section>

      {showDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-destructive hover:underline"
        >
          Delete
        </button>
      )}
    </div>
  );
}
