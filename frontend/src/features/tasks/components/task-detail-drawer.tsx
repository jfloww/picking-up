"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { completedAtLabel } from "../lib/dates";
import type { Scope, Task } from "../types";
import { DONE_CHECKBOX_CLASS } from "./task-item";
import { TaskDetailFields } from "./task-detail-fields";

interface Draft {
  done: boolean;
  memo: string;
  time?: string;
  durationMinutes?: number;
  priority: boolean;
  background: boolean;
  repeatWeekdays: number[];
  detached: boolean;
  dueDate?: string;
  category?: string;
}

function draftFromTask(task: Task): Draft {
  return {
    done: task.done,
    memo: task.memo ?? "",
    time: task.time,
    durationMinutes: task.durationMinutes,
    priority: !!task.priority,
    background: !!task.background,
    repeatWeekdays: task.repeatWeekdays ?? [],
    detached: false,
    dueDate: task.dueDate,
    category: task.scope.kind === "bucket" ? task.scope.category : undefined,
  };
}

export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
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
  onEditSubtaskTitle,
  bucketCategories = [],
  onCategoryChange,
  upcomingRepeatDates,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
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
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  bucketCategories?: string[];
  onCategoryChange?: (category: string) => void;
  upcomingRepeatDates?: string[];
}) {
  const [visible, setVisible] = useState(false);
  // Edits are buffered here and only committed (via the on*Change props
  // above) when Done is clicked — Cancel/X/Escape discard them untouched.
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task));
  // Deleting is immediate (not buffered to Done, like every other action in
  // this file) but destructive enough to want a confirmation step first —
  // the trash button swaps the footer to a Cancel/Confirm pair rather than
  // deleting on the first click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    setDraft(draftFromTask(task));
    setConfirmingDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Back out of the delete confirmation first; a second Escape closes
      // the drawer, same as if delete had never been clicked.
      if (confirmingDelete) {
        setConfirmingDelete(false);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, confirmingDelete]);

  const handleDone = () => {
    if (draft.done !== task.done) onToggle();
    if (draft.memo !== (task.memo ?? "")) onMemoChange(draft.memo);
    if (draft.time !== task.time) onTimeChange(draft.time);
    if (draft.durationMinutes !== task.durationMinutes) onDurationChange(draft.durationMinutes);
    if (draft.priority !== !!task.priority) onPriorityChange(draft.priority);
    if (draft.background !== !!task.background) onBackgroundChange(draft.background);
    if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);
    if (
      task.scope.kind === "bucket" &&
      draft.category !== undefined &&
      draft.category !== task.scope.category
    ) {
      onCategoryChange?.(draft.category);
    }
    const original = task.repeatWeekdays ?? [];
    const weekdaysChanged =
      draft.repeatWeekdays.length !== original.length ||
      draft.repeatWeekdays.some((d, i) => d !== original[i]);
    if (draft.detached) {
      onDetachFromRoutine(weekdaysChanged ? draft.repeatWeekdays : undefined);
    } else if (weekdaysChanged) {
      onRepeatWeekdaysChange(draft.repeatWeekdays);
    }
    onClose();
  };

  const { detached, category: draftCategory, ...draftFields } = draft;
  const draftScope: Scope =
    task.scope.kind === "bucket" && draftCategory !== undefined
      ? { kind: "bucket", category: draftCategory }
      : task.scope;
  const draftTask: Task = {
    ...task,
    ...draftFields,
    scope: draftScope,
    repeatSourceId: detached ? undefined : task.repeatSourceId,
  };

  return (
    <aside
      data-testid="task-detail-drawer"
      aria-label="Task details"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 ease-out",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-7">
        <span className="text-[11px] font-semibold tracking-[0.16em] text-subtle uppercase">
          Task Details
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="thin-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto p-8">
        <div className="flex items-start gap-3" data-testid="task-detail-header">
          <Checkbox
            checked={draft.done}
            onCheckedChange={() => setDraft((d) => ({ ...d, done: !d.done }))}
            aria-label={`Toggle ${task.title}`}
            className={cn("mt-1 size-[18px] border-subtle", DONE_CHECKBOX_CLASS)}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h2
              className={cn(
                "text-[22px] leading-tight font-bold tracking-tight",
                draft.done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </h2>
            {task.done && task.completedAt && (
              <p className="text-xs text-subtle">Completed {completedAtLabel(task.completedAt)}</p>
            )}
          </div>
        </div>

        <TaskDetailFields
          task={draftTask}
          onMemoChange={(memo) => setDraft((d) => ({ ...d, memo }))}
          onTimeChange={(time) => setDraft((d) => ({ ...d, time }))}
          onRepeatWeekdaysChange={(repeatWeekdays) => setDraft((d) => ({ ...d, repeatWeekdays }))}
          onDetachFromRoutine={() => setDraft((d) => ({ ...d, detached: true }))}
          onPriorityChange={(priority) => setDraft((d) => ({ ...d, priority }))}
          onDurationChange={(durationMinutes) => setDraft((d) => ({ ...d, durationMinutes }))}
          onBackgroundChange={(background) => setDraft((d) => ({ ...d, background }))}
          onDueDateChange={(dueDate) => setDraft((d) => ({ ...d, dueDate }))}
          upcomingRepeatDates={upcomingRepeatDates}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
          onEditSubtaskTitle={onEditSubtaskTitle}
          bucketCategories={bucketCategories}
          onCategoryChange={(category) => setDraft((d) => ({ ...d, category }))}
          showTime={task.scope.kind !== "bucket"}
          showDelete={false}
          variant="drawer"
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-background/20 px-8 py-6">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="h-10 flex-1 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-subtle transition-colors duration-200 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-10 flex-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-colors duration-200 hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
            >
              Confirm delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-subtle transition-colors duration-200 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="h-10 flex-1 rounded-lg border border-transparent bg-brand px-4 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete task"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 focus-visible:bg-destructive/10 focus-visible:text-destructive"
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete</span>
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}
