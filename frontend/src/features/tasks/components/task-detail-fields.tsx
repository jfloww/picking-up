"use client";

import { Layers, Plus, RotateCw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { isRoutineTask } from "../lib/nesting";
import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskCategoryEditor } from "./task-category-editor";
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
  onOpenSubtask,
  onPromoteSubtask,
  bucketCategories = [],
  bucketCategoryName,
  onCategoryChange,
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
  onOpenSubtask?: (subtaskId: string) => void;
  onPromoteSubtask?: (subtaskId: string) => void;
  // Category *names* only — categories are resolved to ids by the caller
  // (see TaskDetailDrawer/taskItemHandlers), so this component never needs
  // to know about ids at all.
  bucketCategories?: string[];
  bucketCategoryName?: string;
  onCategoryChange?: (category: string) => void;
  showTime?: boolean;
  showDelete?: boolean;
  variant?: "default" | "drawer";
  upcomingRepeatDates?: string[];
}) {
  const subtasks = task.subtasks ?? [];
  const drawer = variant === "drawer";
  const showRepeat =
    task.scope.kind !== "bucket" && (task.repeatWeekdays !== undefined || task.scope.kind === "day");
  const isRoutine = isRoutineTask(task);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  // Sticky once opened: starts expanded only if there's already a note, so
  // clearing the text mid-edit never yanks the textarea away from under the
  // person typing. Reset (not just lazily initialized) on task switch, same
  // as TaskDetailDrawer's own draft/confirmingDelete state below.
  const [notesExpanded, setNotesExpanded] = useState(drawer ? !!task.memo : true);
  // Controlled, not defaultValue: the drawer swaps between tasks in place
  // (no remount), so this local draft must re-sync to `task.memo` whenever
  // the selected task changes — otherwise the textarea keeps showing the
  // previous task's note text. Same pattern as TaskCategoryEditor's `value`.
  const [memoValue, setMemoValue] = useState(task.memo ?? "");

  useEffect(() => {
    setNotesExpanded(drawer ? !!task.memo : true);
    setMemoValue(task.memo ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    const el = memoRef.current;
    if (drawer && el && notesExpanded) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [drawer, notesExpanded]);

  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((s) => s.done).length;

  const notesSection = (
    <section className={cn(drawer && "space-y-3")}>
      {drawer && (
        <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          Notes
        </h4>
      )}
      {drawer && !notesExpanded ? (
        <button
          type="button"
          onClick={() => setNotesExpanded(true)}
          className="group flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-sm text-foreground/70 outline-none transition-colors duration-200 hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus
            className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-visible:text-amber"
            aria-hidden
          />
          Add a note…
        </button>
      ) : (
        <textarea
          ref={memoRef}
          autoFocus={drawer && !task.memo}
          value={memoValue}
          onChange={(e) => setMemoValue(e.target.value)}
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
      )}
    </section>
  );

  const subtasksSection = (
    <section className={cn(drawer && "space-y-3 border-t border-border pt-7")}>
      {drawer && (
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
            Subtasks
          </h4>
          {subtaskTotal > 0 && (
            <span className="text-[11px] font-medium text-subtle">
              {subtaskDone} / {subtaskTotal}
            </span>
          )}
        </div>
      )}
      {drawer && subtaskTotal > 0 && (
        <div
          role="progressbar"
          aria-label="Subtasks completed"
          aria-valuenow={subtaskDone}
          aria-valuemin={0}
          aria-valuemax={subtaskTotal}
          className="h-0.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-200 ease-out"
            style={{ width: `${(subtaskDone / subtaskTotal) * 100}%` }}
          />
        </div>
      )}
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
        onOpenSubtask={onOpenSubtask}
        onPromote={onPromoteSubtask}
        drawer={drawer}
      />
    </section>
  );

  const schedulingCluster = (
    <div className={cn(drawer ? "space-y-[22px]" : "space-y-1.5")}>
      {showTime && task.scope.kind !== "bucket" && (
        <TaskTimeEditor
          time={task.time}
          onTimeChange={onTimeChange}
          durationMinutes={task.durationMinutes}
          onDurationChange={onDurationChange}
          variant={variant}
        />
      )}
      {showRepeat && (
        <section className={cn(drawer && "space-y-2.5")}>
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
        <section className={cn(drawer && "space-y-2.5")}>
          <TaskDueDateEditor
            dueDate={task.dueDate}
            onDueDateChange={onDueDateChange}
            variant={variant}
          />
        </section>
      )}

      {task.scope.kind === "bucket" && (
        <section className={cn(drawer && "space-y-2.5")}>
          <TaskCategoryEditor
            category={bucketCategoryName ?? ""}
            categories={bucketCategories}
            onCategoryChange={(category) => onCategoryChange?.(category)}
          />
        </section>
      )}

      <div className={cn("flex w-fit items-center gap-2", drawer && "gap-2.5")}>
        <button
          type="button"
          onClick={() => onPriorityChange(!task.priority)}
          aria-pressed={!!task.priority}
          className={cn(
            "flex w-fit items-center gap-1 rounded-full border font-medium transition-colors",
            drawer ? "gap-1.5 px-3.5 py-2 text-sm duration-200" : "px-2 py-1 text-xs",
            task.priority
              ? drawer
                ? "border-brand bg-brand/15 text-brand"
                : "border-transparent bg-brand text-primary-foreground"
              : cn(
                  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  drawer
                    ? "border-border bg-muted/40 text-foreground/80 hover:border-subtle hover:bg-muted/70"
                    : "border-border bg-transparent text-subtle hover:border-subtle",
                ),
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
            "flex w-fit items-center gap-1 rounded-full border font-medium transition-colors",
            drawer ? "gap-1.5 px-3.5 py-2 text-sm duration-200" : "px-2 py-1 text-xs",
            task.background
              ? drawer
                ? "border-brand bg-brand/15 text-brand"
                : "border-transparent bg-brand text-primary-foreground"
              : cn(
                  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  drawer
                    ? "border-border bg-muted/40 text-foreground/80 hover:border-subtle hover:bg-muted/70"
                    : "border-border bg-transparent text-subtle hover:border-subtle",
                ),
          )}
        >
          <Layers className={cn("size-3", drawer && "size-3.5", task.background && "fill-current")} />
          Background
        </button>
      </div>
    </div>
  );

  return (
    <div className={cn(drawer ? "space-y-7" : "space-y-1.5")}>
      {schedulingCluster}

      {subtasksSection}
      {notesSection}

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
