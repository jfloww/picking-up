"use client";

import { GripVertical } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

import { shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
import { compareTasksForDay, dayTasksForWeek, repeatLabelForTask, weeklyRollupTasks } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import type { RescheduleOrReorderDragState } from "./use-drag-to-reschedule-or-reorder";

type GetDragHandlers = (
  id: string,
  title: string,
  sourceDate: string,
  timed: boolean,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

export function ScopeTasks({
  scope,
  quickAdd = false,
  quickAddClassName,
  compact = false,
  onSelectTask,
  highlightOverdue = false,
  showRepeatLabel = false,
  size,
  getDragHandlers,
  itemRefs,
  dragState,
}: {
  scope: Scope;
  quickAdd?: boolean;
  quickAddClassName?: string;
  compact?: boolean;
  onSelectTask?: (id: string) => void;
  highlightOverdue?: boolean;
  showRepeatLabel?: boolean;
  /**
   * Card layout for the rendered rows. Deliberately independent of
   * `getDragHandlers`: a caller that wants drag handles for some other
   * reason must not silently inherit Weekly's compact layout too.
   */
  size?: "week";
  getDragHandlers?: GetDragHandlers;
  itemRefs?: React.RefObject<Record<string, HTMLDivElement | null>>;
  dragState?: RescheduleOrReorderDragState | null;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;

  let items: { task: Task; date: string | null }[];
  if (scope.kind === "week") {
    items = weeklyRollupTasks(tasks, scope.weekStart);
  } else if (scope.kind === "day" && highlightOverdue) {
    const scoped = dayTasksForWeek(tasks, scope.date, weekStartOf(scope.date));
    items = [...scoped].sort(compareTasksForDay).map((task) => ({ task, date: null }));
  } else {
    const key = scopeKey(scope);
    const scoped = tasks.filter((t) => scopeKey(t.scope) === key);
    const ordered =
      scope.kind === "day" ? [...scoped].sort(compareTasksForDay) : scoped;
    items = ordered.map((task) => ({ task, date: null }));
  }

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {items.map(({ task: t }) => {
          const subtasks = t.subtasks ?? [];
          const doneCount = subtasks.filter((s) => s.done).length;
          return (
            <li
              key={t.id}
              className={cn(
                "truncate text-xs text-muted-foreground",
                t.done && "line-through opacity-60",
              )}
            >
              {t.time && <span className="tabular-nums">{t.time} · </span>}
              {t.title}
              {subtasks.length > 0 && (
                <span className="tabular-nums"> · {doneCount}/{subtasks.length}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const today = todayKey();
  const dayDate = scope.kind === "day" ? scope.date : null;

  // The drag state is shared by every day column, so gate the insertion
  // indicator to the column that actually holds the dragged task — that's
  // the only day a "reorder" resolution can refer to. The drag state
  // doesn't carry its source day, so identify it by which column renders
  // the dragged id. `undefined` means "no indicator at all"; `null` is a
  // meaningful value from the hook, meaning "past every item".
  const showIndicator =
    dragState?.resolution.kind === "reorder" &&
    items.some(({ task }) => task.id === dragState.id);
  const indicatorBeforeId =
    showIndicator && dragState?.resolution.kind === "reorder"
      ? dragState.resolution.insertBeforeId
      : undefined;
  const indicator = <li data-testid="reorder-indicator" className="h-0.5 rounded-full bg-brand" />;

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {items.map(({ task: t, date }) => {
          let highlight: "overdue" | "pending" | undefined;
          if (highlightOverdue && dayDate && !t.done) {
            if (dayDate < today) highlight = "overdue";
            else if (dayDate === today) highlight = "pending";
          }
          const taskItem = (
            <TaskItem
              key={t.id}
              size={size}
              rootElement={getDragHandlers ? "div" : "li"}
              task={t}
              dateLabel={date ? shortDateLabel(date, today) : undefined}
              highlight={highlight}
              repeatLabel={showRepeatLabel ? repeatLabelForTask(t, tasks) : undefined}
              onSelect={onSelectTask ? () => onSelectTask(t.id) : undefined}
              {...taskItemHandlers(t.id, actions)}
            />
          );
          if (!getDragHandlers) return taskItem;
          return (
            <Fragment key={t.id}>
              {indicatorBeforeId === t.id && indicator}
              <li
                ref={
                  itemRefs
                    ? (el: HTMLLIElement | null) => {
                        // itemRefs is typed for HTMLDivElement (matching
                        // useDragToRescheduleOrReorder's columnRefs-style
                        // interface), but the row wrapper here is a <li>; the
                        // hook only calls getBoundingClientRect() on it, which
                        // every HTMLElement supports, so this cast is safe.
                        itemRefs.current[t.id] = el as unknown as HTMLDivElement | null;
                      }
                    : undefined
                }
                className="flex min-h-11 items-stretch gap-1.5 sm:min-h-0"
              >
                <button
                  type="button"
                  aria-label={`Reorder ${t.title}`}
                  // No fixed height: stretches to match the card's height via
                  // items-stretch above, so a two-line (metadata + title) card
                  // gets a taller handle spanning both lines, not just the
                  // first one.
                  className="flex w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle hover:bg-muted/60 hover:text-foreground active:cursor-grabbing sm:w-5"
                  {...getDragHandlers(t.id, t.title, dayDate!, !!t.time)}
                >
                  <GripVertical className="size-3.5" />
                </button>
                <div className="min-w-0 flex-1">{taskItem}</div>
              </li>
            </Fragment>
          );
        })}
        {showIndicator && indicatorBeforeId === null && indicator}
      </ul>
      {quickAdd && (
        <div className={quickAddClassName}>
          <QuickAdd onAdd={(title) => addTask(title, scope)} />
        </div>
      )}
    </div>
  );
}
