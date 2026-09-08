"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { completedAtLabel } from "../lib/dates";
import type { Category, Task } from "../types";
import { PromoteUndoToast } from "./promote-undo-toast";
import { SubtaskDetailPanel } from "./subtask-detail-panel";
import { DONE_CHECKBOX_CLASS } from "./task-item";
import { TaskDetailFields } from "./task-detail-fields";
import { useFocusTrap, useRestoreFocusOnUnmount } from "./use-focus-trap";

interface Draft {
  title: string;
  done: boolean;
  memo: string;
  time?: string;
  durationMinutes?: number;
  priority: boolean;
  background: boolean;
  repeatWeekdays: number[];
  detached: boolean;
  dueDate?: string;
  scheduledDate?: string;
  category?: string;
}

// Categories are resolved by id everywhere else; this drawer's editor still
// works in terms of the display name (matching TaskCategoryEditor's
// free-text, create-or-reuse-by-name UX), so it needs this lookup both to
// seed the draft and to detect whether the name was actually changed.
function categoryNameFor(categoryId: string, categories: Category[]): string | undefined {
  return categories.find((c) => c.id === categoryId)?.name;
}

// A single-line title clips long text instead of showing all of it — same
// auto-grow technique already used for the subtask title/notes fields and
// this drawer's own memo textarea.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function draftFromTask(task: Task, categories: Category[]): Draft {
  const scheduledDate =
    task.scope.kind === "day"
      ? task.scope.date
      : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
        ? task.rolledFrom.date
        : undefined;
  return {
    title: task.title,
    done: task.done,
    memo: task.memo ?? "",
    time: task.time,
    durationMinutes: task.durationMinutes,
    priority: !!task.priority,
    background: !!task.background,
    repeatWeekdays: task.repeatWeekdays ?? [],
    detached: false,
    dueDate: task.dueDate,
    scheduledDate,
    category: task.scope.kind === "bucket" ? categoryNameFor(task.scope.categoryId, categories) : undefined,
  };
}

export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTitleChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDetachFromRoutine,
  onPriorityChange,
  onDurationChange,
  onBackgroundChange,
  onDueDateChange,
  onScheduledDateChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onReorderSubtask,
  onEditSubtaskTitle,
  onEditSubtaskMemo,
  onPromoteSubtask,
  onUndoPromoteSubtask,
  bucketCategories = [],
  onCategoryChange,
  upcomingRepeatDates,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTitleChange: (title: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDetachFromRoutine: () => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDueDateChange: (dueDate?: string) => void;
  onScheduledDateChange?: (date: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onReorderSubtask: (subtaskId: string, insertBeforeId: string | null) => void;
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  onEditSubtaskMemo: (subtaskId: string, memo: string) => void;
  onPromoteSubtask: (subtaskId: string) => Task | undefined;
  onUndoPromoteSubtask: (taskId: string) => void;
  // Full Category objects, not names — this drawer needs ids both to
  // resolve the task's current categoryId to a display name (draftFromTask
  // below) and to hand TaskDetailFields the plain-name list it expects.
  bucketCategories?: Category[];
  onCategoryChange?: (category: string) => void;
  upcomingRepeatDates?: string[];
}) {
  const [visible, setVisible] = useState(false);
  // Edits are buffered here and only committed (via the on*Change props
  // above) when Done is clicked — Cancel/X/Escape discard them untouched.
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task, bucketCategories));
  // Deleting is immediate (not buffered to Done, like every other action in
  // this file) but destructive enough to want a confirmation step first —
  // the trash button swaps the footer to a Cancel/Confirm pair rather than
  // deleting on the first click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // subtaskId is tracked alongside the toast's title/taskId so the promoted
  // row can be filtered out of draftTask.subtasks below. In real usage the
  // store update and setPromoteToast happen in the same synchronous handler,
  // so this filter isn't closing a live timing gap — it exists because this
  // file's tests drive onPromoteSubtask with a mocked handler that never
  // touches a real store (without it, the test's static `task` prop would
  // still show the promoted subtask), and as cheap insurance if the store's
  // update path ever becomes genuinely asynchronous later.
  const [promoteToast, setPromoteToast] = useState<{
    title: string;
    taskId: string;
    subtaskId: string;
  } | null>(null);
  const [openSubtaskId, setOpenSubtaskId] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title]);

  // Bounds Tab-cycling to the whole drawer, except while the Subtask Detail
  // panel is open — then it hands that boundary over to the panel's own
  // trap, so the drawer's now-covered footer controls (Cancel/Done/Delete)
  // fall out of the keyboard tab order instead of staying reachable behind
  // the panel.
  useFocusTrap(asideRef, !openSubtaskId);
  useRestoreFocusOnUnmount(asideRef);

  useEffect(() => {
    setDraft(draftFromTask(task, bucketCategories));
    setConfirmingDelete(false);
    setPromoteToast(null);
    setOpenSubtaskId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Layered like a stack: the Subtask Detail panel is the most
      // recently opened layer, so it backs out first. Next, back out of
      // the delete confirmation. Only once both are closed does a further
      // Escape close the whole drawer, discarding buffered draft edits.
      if (openSubtaskId) {
        setOpenSubtaskId(null);
        return;
      }
      if (confirmingDelete) {
        setConfirmingDelete(false);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, confirmingDelete, openSubtaskId]);

  const handleDone = () => {
    if (draft.done !== task.done) onToggle();
    if (draft.memo !== (task.memo ?? "")) onMemoChange(draft.memo);
    if (draft.title !== task.title) onTitleChange(draft.title);
    if (draft.time !== task.time) onTimeChange(draft.time);
    if (draft.durationMinutes !== task.durationMinutes) onDurationChange(draft.durationMinutes);
    if (draft.priority !== !!task.priority) onPriorityChange(draft.priority);
    if (draft.background !== !!task.background) onBackgroundChange(draft.background);
    if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);
    const originalScheduledDate =
      task.scope.kind === "day"
        ? task.scope.date
        : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
          ? task.rolledFrom.date
          : undefined;
    if (
      draft.scheduledDate &&
      draft.scheduledDate !== originalScheduledDate
    ) {
      onScheduledDateChange?.(draft.scheduledDate);
    }
    if (
      task.scope.kind === "bucket" &&
      draft.category !== undefined &&
      draft.category !== categoryNameFor(task.scope.categoryId, bucketCategories)
    ) {
      onCategoryChange?.(draft.category);
    }
    if (draft.detached) {
      onDetachFromRoutine();
    } else {
      const original = task.repeatWeekdays ?? [];
      const weekdaysChanged =
        draft.repeatWeekdays.length !== original.length ||
        draft.repeatWeekdays.some((d, i) => d !== original[i]);
      if (weekdaysChanged) onRepeatWeekdaysChange(draft.repeatWeekdays);
    }
    onClose();
  };

  function handlePromoteSubtask(subtaskId: string) {
    const created = onPromoteSubtask(subtaskId);
    if (created) setPromoteToast({ title: created.title, taskId: created.id, subtaskId });
  }

  const { detached, category: draftCategory, scheduledDate, ...draftFields } = draft;
  // The task's scope (and its categoryId) never changes here — a category
  // edit is applied via onCategoryChange on Done, like every other field,
  // not by mutating scope in this preview object. draftCategory carries the
  // live-typed name straight to TaskDetailFields below instead.
  const draftTask: Task = {
    ...task,
    ...draftFields,
    repeatSourceId: detached ? undefined : task.repeatSourceId,
    // See the promoteToast comment above: this filter is for test
    // determinism against a mocked onPromoteSubtask, plus future-proofing
    // against an async store, not a real rendering race today.
    subtasks: promoteToast
      ? task.subtasks?.filter((s) => s.id !== promoteToast.subtaskId)
      : task.subtasks,
  };

  const openSubtask = task.subtasks?.find((s) => s.id === openSubtaskId);

  return (
    <aside
      ref={asideRef}
      data-testid="task-detail-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Task details"
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-50 flex w-full flex-col bg-card shadow-2xl transition-transform duration-200 ease-out sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-w-full sm:border-l sm:border-border",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)] sm:h-[72px] sm:px-7 sm:pt-0">
        <span className="text-[11px] font-semibold tracking-[0.16em] text-subtle uppercase">
          Task Details
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground sm:size-8"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="thin-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4 max-sm:[&_input]:text-base max-sm:[&_textarea:not([aria-label='Task_title'])]:text-base sm:space-y-7 sm:p-8">
        <div className="flex items-start gap-3" data-testid="task-detail-header">
          <Checkbox
            checked={draft.done}
            onCheckedChange={() => setDraft((d) => ({ ...d, done: !d.done }))}
            aria-label={`Toggle ${task.title}`}
            className={cn("mt-1 size-6 border-subtle sm:size-[18px]", DONE_CHECKBOX_CLASS)}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <textarea
              ref={titleRef}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value.replace(/\r?\n/g, " ") }))
              }
              onKeyDown={(e) => {
                // A title stays one logical line even once it visually
                // wraps. Enter follows the footer's Done path so every
                // buffered edit is committed before the drawer closes.
                // The dedicated subtask composer keeps its own form submit
                // behavior and is intentionally unaffected.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleDone();
                }
              }}
              rows={1}
              aria-label="Task title"
              className={cn(
                "w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent text-xl leading-tight font-bold tracking-tight outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-[22px]",
                draft.done && "text-muted-foreground line-through",
              )}
            />
            {task.done && task.completedAt && (
              <p className="text-xs text-subtle">Completed {completedAtLabel(task.completedAt)}</p>
            )}
          </div>
        </div>

        {scheduledDate && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-subtle">Move to date</span>
            <input
              type="date"
              value={scheduledDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, scheduledDate: event.target.value }))
              }
              aria-label="Move to date"
              className="min-h-11 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-0 sm:text-sm"
            />
          </label>
        )}

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
          upcomingRepeatDates={detached ? undefined : upcomingRepeatDates}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
          onReorderSubtask={onReorderSubtask}
          onOpenSubtask={(subtaskId) =>
            setOpenSubtaskId((current) => (current === subtaskId ? null : subtaskId))
          }
          onPromoteSubtask={handlePromoteSubtask}
          bucketCategories={bucketCategories.map((c) => c.name)}
          bucketCategoryName={draftCategory}
          onCategoryChange={(category) => setDraft((d) => ({ ...d, category }))}
          showTime={task.scope.kind !== "bucket"}
          showDelete={false}
          repeatDisabled={detached}
          variant="drawer"
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:bg-background/20 sm:px-8 sm:py-6">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="h-11 flex-1 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-subtle transition-colors duration-200 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-11 flex-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-colors duration-200 hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 sm:h-10"
            >
              Confirm delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-subtle transition-colors duration-200 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="h-11 flex-1 rounded-lg border border-transparent bg-brand px-4 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-10"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete task"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 sm:size-10"
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete</span>
            </button>
          </>
        )}
      </footer>
      {openSubtask && (
        <SubtaskDetailPanel
          subtask={openSubtask}
          onClose={() => setOpenSubtaskId(null)}
          onTitleChange={(title) => onEditSubtaskTitle(openSubtask.id, title)}
          onMemoChange={(memo) => onEditSubtaskMemo(openSubtask.id, memo)}
        />
      )}
      {promoteToast && (
        <PromoteUndoToast
          key={promoteToast.taskId}
          title={promoteToast.title}
          onUndo={() => {
            onUndoPromoteSubtask(promoteToast.taskId);
            setPromoteToast(null);
          }}
          onDismiss={() => setPromoteToast(null)}
        />
      )}
    </aside>
  );
}
