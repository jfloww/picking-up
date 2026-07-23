"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { addMinutesToTime } from "../lib/times";
import type { Task } from "../types";
import { TaskDetailFields } from "./task-detail-fields";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  setPriority: (id: string, priority: boolean) => void;
  setDuration: (id: string, durationMinutes: number | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
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
    onPriorityChange: (priority: boolean) => actions.setPriority(id, priority),
    onDurationChange: (durationMinutes?: number) => actions.setDuration(id, durationMinutes),
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
  onPriorityChange,
  onDurationChange,
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
  size?: "default" | "large" | "timeline";
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
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
  const largeMeta = task.time
    ? `${highlight === "overdue" ? "Overdue • " : ""}${formatTaskTimeRange(task.time, task.durationMinutes)}`
    : "All Day";

  const timeBadge = task.time && (
    <span
      className={cn(
        "shrink-0 tabular-nums text-subtle",
        timeline ? "text-[11px]" : "text-xs",
      )}
    >
      {timeline ? formatTaskTimeRange(task.time, task.durationMinutes) : formatTaskTime(task.time)}
    </span>
  );

  const selectOrToggle = () => (onSelect ? onSelect() : setOpen((o) => !o));

  if (timeline) {
    return (
      <li>
        <div
          onClick={selectOrToggle}
          className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2.5"
        >
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
      </li>
    );
  }

  return (
    <li>
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
            className={large ? "size-[18px] border-subtle" : undefined}
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
            onPriorityChange={onPriorityChange}
            onDurationChange={onDurationChange}
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
