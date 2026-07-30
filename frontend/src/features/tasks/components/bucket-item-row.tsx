"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { dueDateLabel, isOverdue, todayKey } from "../lib/dates";
import type { Task } from "../types";

// Cardless ~40px row, deliberately mirroring subtask-list.tsx's
// DrawerSubtaskRow: checkbox, click target, hover/focus-revealed delete.
// Unlike a subtask row, the click target opens the Task Detail drawer
// rather than editing inline — bucket items are full Tasks with their own
// drawer, and no task row anywhere in this app currently supports inline
// title editing (confirmed: neither TaskItem nor the drawer's header has
// one), so this doesn't invent it just for bucket items either.
export function BucketItemRow({
  task,
  onToggle,
  onSelect,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const today = todayKey();
  const badgeClass = "shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground";

  return (
    <li className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
      <Checkbox
        checked={task.done}
        onCheckedChange={onToggle}
        aria-label={`Toggle ${task.title}`}
        className="shrink-0 border-subtle"
      />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          task.done && "text-muted-foreground line-through hover:text-muted-foreground",
        )}
      >
        {task.title}
      </button>
      {task.dueDate && (
        <span
          className={cn(
            badgeClass,
            isOverdue(task.dueDate, today) && !task.done && "bg-destructive/10 text-destructive",
          )}
        >
          {dueDateLabel(task.dueDate, today)}
        </span>
      )}
      {task.priority && <span className={badgeClass}>Priority</span>}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${task.title}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}
