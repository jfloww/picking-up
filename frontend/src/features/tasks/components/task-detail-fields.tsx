"use client";

import { Layers, RotateCw, Star } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskDueDateEditor } from "./task-due-date-editor";
import { TaskRepeatPicker } from "./task-repeat-picker";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDetachFromRoutine,
  onPriorityChange,
  onDurationChange,
  onBackgroundChange,
  onDueDateChange,
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
  onDetachFromRoutine: () => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDueDateChange: (dueDate?: string) => void;
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
  const isRoutine = task.repeatWeekdays !== undefined || task.repeatSourceId !== undefined;
  const memoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = memoRef.current;
    if (drawer && el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [drawer]);

  return (
    <div className={cn(drawer ? "space-y-7" : "space-y-1.5")}>
      {showTime && (
        <TaskTimeEditor
          time={task.time}
          onTimeChange={onTimeChange}
          durationMinutes={task.durationMinutes}
          onDurationChange={onDurationChange}
          variant={variant}
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
              <button
                type="button"
                onClick={() => onDetachFromRoutine()}
                className="text-subtle underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                Detach
              </button>
            </span>
          ) : (
            <TaskRepeatPicker
              weekdays={task.repeatWeekdays ?? []}
              onChange={onRepeatWeekdaysChange}
              drawer={drawer}
            />
          )}
          {upcomingRepeatDates && upcomingRepeatDates.length > 0 && (
            <p className="text-[11px] text-subtle">
              Next: {upcomingRepeatDates.join(", ")}
            </p>
          )}
        </section>
      )}

      {!isRoutine && (
        <section className={cn(drawer && "space-y-3")}>
          <TaskDueDateEditor
            dueDate={task.dueDate}
            onDueDateChange={onDueDateChange}
            variant={variant}
          />
        </section>
      )}

      <div className={cn("flex w-fit items-center gap-2", drawer && "gap-2.5")}>
        <button
          type="button"
          onClick={() => onPriorityChange(!task.priority)}
          aria-pressed={!!task.priority}
          className={cn(
            "flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors",
            task.priority
              ? "border-transparent bg-brand text-primary-foreground"
              : "border-border bg-transparent text-subtle hover:border-subtle hover:text-foreground",
            drawer && "px-3.5 py-2 text-sm",
          )}
        >
          <Star className={cn("size-3", drawer && "size-3.5", task.priority && "fill-current")} />
          Priority
        </button>
        <button
          type="button"
          onClick={() => onBackgroundChange(!task.background)}
          aria-pressed={!!task.background}
          className={cn(
            "flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors",
            task.background
              ? "border-transparent bg-brand text-primary-foreground"
              : "border-border bg-transparent text-subtle hover:border-subtle hover:text-foreground",
            drawer && "px-3.5 py-2 text-sm",
          )}
        >
          <Layers className={cn("size-3", drawer && "size-3.5", task.background && "fill-current")} />
          Background
        </button>
      </div>

      <section className={cn(drawer && "space-y-3")}>
        {drawer && (
          <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
            Notes
          </h4>
        )}
        <textarea
          ref={memoRef}
          defaultValue={task.memo ?? ""}
          onBlur={(e) => onMemoChange(e.target.value)}
          onInput={
            drawer
              ? (e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              : undefined
          }
          placeholder="Memo"
          rows={drawer ? 3 : 2}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "overflow-hidden rounded-lg bg-muted/30 p-3 text-sm leading-relaxed",
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
          drawer={drawer}
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
