"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { dueDateLabel, isOverdue, todayKey } from "../lib/dates";
import { addMinutesToTime } from "../lib/times";
import type { Category, Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";

// Applied only to checkboxes that represent top-level task completion (not
// subtasks, not the shared Checkbox primitive's default styling), so the
// green + pop feedback stays scoped to "this task is done".
export const DONE_CHECKBOX_CLASS =
  "data-checked:border-success data-checked:bg-success data-checked:animate-task-complete";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  detachFromRoutine: (id: string, weekdays?: number[]) => void;
  setPriority: (id: string, priority: boolean) => void;
  setDuration: (id: string, durationMinutes: number | undefined) => void;
  setBackground: (id: string, background: boolean) => void;
  setDueDate: (id: string, dueDate: string | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  editSubtaskMemo: (id: string, subtaskId: string, memo: string) => void;
  promoteSubtaskToTask: (id: string, subtaskId: string) => Task | undefined;
  convertTaskToSubtask: (id: string, targetId: string, confirmDataLoss?: boolean) => void;
  setCategory: (id: string, categoryId: string) => void;
  createCategory: (name: string) => Promise<Category | undefined>;
}

function formatHourMinute(hour: number, minute: number): string {
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
}

function periodOf(hour: number): "AM" | "PM" {
  return hour >= 12 ? "PM" : "AM";
}

function formatTaskTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${formatHourMinute(hour, minute)} ${periodOf(hour)}`;
}

function formatTaskTimeRange(time: string, durationMinutes?: number): string {
  if (!durationMinutes) return formatTaskTime(time);
  const [hour, minute] = time.split(":").map(Number);
  const end = addMinutesToTime(time, durationMinutes);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startPeriod = periodOf(hour);
  const endPeriod = periodOf(endHour);
  const startLabel =
    startPeriod === endPeriod
      ? formatHourMinute(hour, minute)
      : `${formatHourMinute(hour, minute)} ${startPeriod}`;
  return `${startLabel} – ${formatHourMinute(endHour, endMinute)} ${endPeriod}`;
}

// Builds TaskItem's callback props from store actions; shared by ScopeTasks
// and DayTimeline so the wiring lives in one place.
export function taskItemHandlers(id: string, actions: TaskItemActions) {
  return {
    onToggle: () => actions.toggleTask(id),
    onMemoChange: (memo: string) => actions.setMemo(id, memo),
    onTimeChange: (time?: string) => actions.setTime(id, time),
    onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
    onDetachFromRoutine: (weekdays?: number[]) => actions.detachFromRoutine(id, weekdays),
    onPriorityChange: (priority: boolean) => actions.setPriority(id, priority),
    onDurationChange: (durationMinutes?: number) => actions.setDuration(id, durationMinutes),
    onBackgroundChange: (background: boolean) => actions.setBackground(id, background),
    onDueDateChange: (dueDate?: string) => actions.setDueDate(id, dueDate),
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
    onEditSubtaskTitle: (subtaskId: string, title: string) =>
      actions.editSubtaskTitle(id, subtaskId, title),
    onEditSubtaskMemo: (subtaskId: string, memo: string) => actions.editSubtaskMemo(id, subtaskId, memo),
    onPromoteSubtask: (subtaskId: string) => actions.promoteSubtaskToTask(id, subtaskId),
    // confirmDataLoss: true — undoing a promotion the user just made is a
    // single-click action, not a place to interrupt with the same
    // confirmation dialog a regular nest gets. The only field this can
    // lose that a normal nest couldn't is completedAt, and only when the
    // promoted subtask was already done — a value the promotion itself
    // synthesized moments earlier, not something the user is at risk of
    // losing by surprise (PR#52 review finding: this was previously wired
    // with no confirmDataLoss at all, so it silently stopped working the
    // moment completedAt joined the server's lossy-field checks).
    onUndoPromoteSubtask: (taskId: string) => actions.convertTaskToSubtask(taskId, id, true),
    // The editor works in category names (create-or-reuse UX); resolve to
    // a stable id here before handing off to the store, which only ever
    // deals in categoryId.
    onCategoryChange: (categoryName: string) => {
      void actions.createCategory(categoryName).then((category) => {
        if (category) actions.setCategory(id, category.id);
      });
    },
  };
}

export function TaskItem({
  task,
  dateLabel,
  highlight,
  repeatLabel,
  size = "default",
  rootElement = "li",
  onToggle,
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
  onSelect,
}: {
  task: Task;
  dateLabel?: string;
  highlight?: "overdue" | "pending";
  repeatLabel?: string;
  size?: "default" | "large" | "timeline" | "week";
  rootElement?: "li" | "div";
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDetachFromRoutine: (weekdays?: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDueDateChange: (dueDate?: string) => void;
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
  const timeline = size === "timeline";
  const week = size === "week";
  const Root = rootElement;
  const largeMeta = task.time
    ? `${highlight === "overdue" ? "Overdue • " : ""}${formatTaskTimeRange(task.time, task.durationMinutes)}`
    : "All Day";

  const timeBadge = task.time && (
    <span
      className={cn(
        "shrink-0 tabular-nums text-subtle",
        timeline || week ? "text-[11px]" : "text-xs",
      )}
    >
      {timeline ? formatTaskTimeRange(task.time, task.durationMinutes) : formatTaskTime(task.time)}
    </span>
  );

  const today = todayKey();
  const dueBadge = task.dueDate && !timeline && (
    <span
      className={cn(
        "shrink-0 rounded bg-muted font-medium text-muted-foreground",
        large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
        isOverdue(task.dueDate, today) && !task.done && "bg-destructive/10 text-destructive",
      )}
    >
      {dueDateLabel(task.dueDate, today)}
    </span>
  );

  const selectOrToggle = () => (onSelect ? onSelect() : setOpen((o) => !o));

  if (timeline) {
    return (
      <Root>
        <div
          onClick={selectOrToggle}
          className="absolute inset-0 flex cursor-pointer items-center gap-3 px-3 py-2.5"
        >
          <span onClick={(e) => e.stopPropagation()} className="contents">
            <Checkbox
              checked={task.done}
              onCheckedChange={onToggle}
              aria-label={`Toggle ${task.title}`}
              className={DONE_CHECKBOX_CLASS}
            />
          </span>
          <button
            type="button"
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[15px] leading-5 font-semibold",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
          {timeBadge}
        </div>
      </Root>
    );
  }

  if (week) {
    const hasMeta = !!task.time || subtasks.length > 0 || !!repeatLabel;
    return (
      <Root>
        <div
          className={cn(
            "rounded-lg bg-muted px-2 py-1.5",
            task.done && "opacity-55",
            highlight === "overdue" &&
              "border-l-2 border-destructive bg-destructive/10 pl-1.5 pr-2",
            highlight === "pending" &&
              "border-l-2 border-warning bg-warning/10 pl-1.5 pr-2",
          )}
        >
          {hasMeta && (
            <div className="flex items-center gap-1.5">
              <span onClick={(e) => e.stopPropagation()} className="contents">
                <Checkbox
                  checked={task.done}
                  onCheckedChange={onToggle}
                  aria-label={`Toggle ${task.title}`}
                  className={cn("size-[13px] border-subtle", DONE_CHECKBOX_CLASS)}
                />
              </span>
              {repeatLabel && (
                <span className="min-w-0 truncate rounded bg-card px-1 text-[9.5px] font-medium text-muted-foreground">
                  {repeatLabel}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {timeBadge}
                {subtasks.length > 0 && (
                  <span
                    aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
                    className="shrink-0 rounded bg-card px-1 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {doneCount}/{subtasks.length}
                  </span>
                )}
              </span>
            </div>
          )}
          {!hasMeta && (
            <span className="flex items-center gap-1.5">
              <span onClick={(e) => e.stopPropagation()} className="contents">
                <Checkbox
                  checked={task.done}
                  onCheckedChange={onToggle}
                  aria-label={`Toggle ${task.title}`}
                  className={cn("size-[13px] border-subtle", DONE_CHECKBOX_CLASS)}
                />
              </span>
              <button
                type="button"
                onClick={selectOrToggle}
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-[12.5px] leading-[1.35]",
                  task.done && "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </button>
            </span>
          )}
          {hasMeta && (
            <button
              type="button"
              onClick={selectOrToggle}
              className={cn(
                "mt-1 block w-full truncate text-left text-[12.5px] leading-[1.35]",
                task.done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </button>
          )}
        </div>
      </Root>
    );
  }

  return (
    <Root>
      <div
        onClick={large ? selectOrToggle : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md",
          large &&
            "group min-h-16 cursor-pointer gap-4 rounded-xl bg-muted px-4 py-2.5 ring-1 ring-border transition-colors hover:bg-accent hover:ring-brand/30",
          large && !task.time && !task.done && "min-h-[52px]",
          large && task.done && "min-h-[52px] bg-transparent opacity-50 ring-border/60",
          !large && "py-1.5",
          highlight === "overdue" &&
            (large
              ? "ring-destructive/40"
              : "border-l-2 border-destructive bg-destructive/10 pl-1.5"),
          highlight === "pending" &&
            (large
              ? "ring-warning/40"
              : "border-l-2 border-warning bg-warning/10 pl-1.5"),
        )}
      >
        <span onClick={(e) => e.stopPropagation()} className="contents">
          <Checkbox
            checked={task.done}
            onCheckedChange={onToggle}
            aria-label={`Toggle ${task.title}`}
            className={cn(large && "size-[18px] border-subtle", DONE_CHECKBOX_CLASS)}
          />
        </span>
        {dateLabel && (
          <span className="shrink-0 text-xs text-subtle">{dateLabel}</span>
        )}
        {!large && timeBadge}
        {large ? (
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className={cn(
                "block w-full truncate text-left text-[15px] leading-5 font-semibold",
                task.done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </button>
            {!task.done && (
              <p
                className={cn(
                  "mt-0.5 truncate text-[11px] font-medium tracking-wide text-subtle uppercase",
                  task.time && "text-[12px] font-normal tracking-normal text-muted-foreground normal-case",
                  highlight === "overdue" && "text-destructive",
                  highlight === "pending" && "text-warning",
                )}
              >
                {largeMeta}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={selectOrToggle}
            className={cn(
              "min-w-0 flex-1 truncate text-left text-base font-medium",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
        )}
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className={cn(
              "shrink-0 rounded bg-muted tabular-nums text-muted-foreground",
              large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
            )}
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {dueBadge}
        {repeatLabel && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
            )}
          >
            {repeatLabel}
          </span>
        )}
        {task.priority && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
            )}
          >
            Priority
          </span>
        )}
        {task.background && (
          <span
            className={cn(
              "shrink-0 rounded bg-muted font-medium text-muted-foreground",
              large ? "px-1.5 text-[10px]" : "px-1 text-[10px]",
            )}
          >
            Background
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
            onDetachFromRoutine={onDetachFromRoutine}
            onPriorityChange={onPriorityChange}
            onDurationChange={onDurationChange}
            onBackgroundChange={onBackgroundChange}
            onDueDateChange={onDueDateChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
        </div>
      )}
    </Root>
  );
}
