"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { DONE_CHECKBOX_CLASS } from "./task-item";
import { TaskDetailFields } from "./task-detail-fields";
import { TaskTimeEditor } from "./task-time-editor";

interface Draft {
  done: boolean;
  memo: string;
  time?: string;
  durationMinutes?: number;
  priority: boolean;
  background: boolean;
  repeatWeekdays: number[];
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
  };
}

export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onPriorityChange,
  onDurationChange,
  onBackgroundChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  upcomingRepeatDates,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  upcomingRepeatDates?: string[];
}) {
  const [visible, setVisible] = useState(false);
  // Edits are buffered here and only committed (via the on*Change props
  // above) when Done is clicked — Cancel/X/Escape discard them untouched.
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task));

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    setDraft(draftFromTask(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleDone = () => {
    if (draft.done !== task.done) onToggle();
    if (draft.memo !== (task.memo ?? "")) onMemoChange(draft.memo);
    if (draft.time !== task.time) onTimeChange(draft.time);
    if (draft.durationMinutes !== task.durationMinutes) onDurationChange(draft.durationMinutes);
    if (draft.priority !== !!task.priority) onPriorityChange(draft.priority);
    if (draft.background !== !!task.background) onBackgroundChange(draft.background);
    const original = task.repeatWeekdays ?? [];
    const changed =
      draft.repeatWeekdays.length !== original.length ||
      draft.repeatWeekdays.some((d, i) => d !== original[i]);
    if (changed) onRepeatWeekdaysChange(draft.repeatWeekdays);
    onClose();
  };

  const draftTask: Task = { ...task, ...draft };

  return (
    <aside
      data-testid="task-detail-drawer"
      aria-label="Task details"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-full flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 ease-out",
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

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-8">
        <div className="flex items-start gap-3" data-testid="task-detail-header">
          <Checkbox
            checked={draft.done}
            onCheckedChange={() => setDraft((d) => ({ ...d, done: !d.done }))}
            aria-label={`Toggle ${task.title}`}
            className={cn("mt-1 size-[18px]", DONE_CHECKBOX_CLASS)}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <h2
              className={cn(
                "text-[22px] leading-tight font-bold tracking-tight",
                draft.done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </h2>
            <TaskTimeEditor
              time={draft.time}
              onTimeChange={(time) => setDraft((d) => ({ ...d, time }))}
              durationMinutes={draft.durationMinutes}
              onDurationChange={(durationMinutes) =>
                setDraft((d) => ({ ...d, durationMinutes }))
              }
            />
          </div>
        </div>

        <TaskDetailFields
          task={draftTask}
          onMemoChange={(memo) => setDraft((d) => ({ ...d, memo }))}
          onTimeChange={(time) => setDraft((d) => ({ ...d, time }))}
          onRepeatWeekdaysChange={(repeatWeekdays) => setDraft((d) => ({ ...d, repeatWeekdays }))}
          onPriorityChange={(priority) => setDraft((d) => ({ ...d, priority }))}
          onDurationChange={(durationMinutes) => setDraft((d) => ({ ...d, durationMinutes }))}
          onBackgroundChange={(background) => setDraft((d) => ({ ...d, background }))}
          upcomingRepeatDates={upcomingRepeatDates}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
          showTime={false}
          showDelete={false}
          variant="drawer"
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-background/20 p-6">
        <button
          type="button"
          onClick={onClose}
          className="h-10 flex-1 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-subtle transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="h-10 flex-1 rounded-lg border border-border bg-muted px-4 text-sm font-medium transition-colors hover:bg-muted/70"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete task"
          className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete</span>
        </button>
      </footer>
    </aside>
  );
}
