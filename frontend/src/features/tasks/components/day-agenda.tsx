"use client";

import { GripVertical } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { todayKey } from "../lib/dates";
import { nestBlockReasonFor, type NestBlockReason } from "../lib/nesting";
import { compareTasksForDay, isPastToday, nowTime } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope, type Task } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import { useDragToReorder } from "./use-drag-to-reorder";
import type { DragState } from "./use-drag-to-schedule";
import { useTaskTransitionClasses } from "./use-task-transition-classes";

type GetDragHandlers = (
  id: string,
  title: string,
  nestBlockReason: NestBlockReason | undefined,
) => {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

export function DayAgenda({
  date,
  onSelectTask,
  agendaZoneRef,
  getDragHandlers,
  cardRefs,
  dragState,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  agendaZoneRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
  cardRefs: React.RefObject<Record<string, HTMLElement | null>>;
  dragState: DragState | null;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);

  const transitions = useTaskTransitionClasses(dayTasks);
  const isDone = (t: Task) => transitions.get(t.id)?.done ?? t.done;

  const allDayToDo = [...dayTasks.filter((t) => !t.time && !isDone(t))].sort(
    (a, b) => a.order - b.order,
  );
  const nextUp = [...dayTasks.filter((t) => !!t.time && !isDone(t))].sort(compareTasksForDay);
  const doneToday = dayTasks.filter((t) => isDone(t));

  const today = todayKey();
  const isViewingToday = date === today;
  const currentTime = nowTime();

  const reorderItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reorderContainerRef = useRef<HTMLDivElement | null>(null);

  function handleReorder(id: string, insertBeforeId: string | null) {
    const currentIndex = allDayToDo.findIndex((t) => t.id === id);
    if (currentIndex === -1) return;
    const remaining = allDayToDo.filter((t) => t.id !== id);
    const targetIndex =
      insertBeforeId === null ? remaining.length : remaining.findIndex((t) => t.id === insertBeforeId);
    if (targetIndex === -1) return;
    // Compare list *positions*, not just a resolved order value: the
    // dragged item currently sits at currentIndex within allDayToDo
    // (dragged still present). Removing it to build `remaining` shifts
    // every later index down by one, so the slot it already occupies is
    // targetIndex === currentIndex in `remaining`'s index space — e.g.
    // dropping it directly above its current next-neighbor recomputes
    // the same position even though insertBeforeId now names a
    // *different* neighbor than "itself." Catching that here (rather
    // than only `id === insertBeforeId`) avoids a no-op drag firing a
    // real reorderTask/network call — the server has no cheap way to
    // detect "this would be a no-op" itself without first doing the same
    // work the client just did.
    if (targetIndex === currentIndex) return;
    actions.reorderTask(id, insertBeforeId);
  }

  const { dragState: reorderDragState, getDragHandlers: getReorderHandlers } = useDragToReorder({
    containerRef: reorderContainerRef,
    itemRefs: reorderItemRefs,
    orderedIds: allDayToDo.map((t) => t.id),
    onReorder: handleReorder,
  });

  function renderCard(t: Task, highlight?: "overdue" | "pending", reorderable = false) {
    return (
      <div key={t.id}>
        {reorderable && reorderDragState?.insideList && reorderDragState.insertBeforeId === t.id && (
          <div data-testid="reorder-indicator" className="h-0.5 rounded-full bg-brand" />
        )}
        <div
          ref={(el) => {
            // cardRefs is a long-lived ref owned by DailyView (not rebuilt
            // per render), so entries must be actively cleaned up on
            // unmount rather than relying on a later render to overwrite
            // them — otherwise every task ever rendered this session
            // leaves a dead key behind for resolve() to iterate over.
            if (el) {
              cardRefs.current[t.id] = el;
            } else {
              delete cardRefs.current[t.id];
            }
            if (reorderable) {
              reorderItemRefs.current[t.id] = el;
            }
          }}
          data-testid={`agenda-${t.id}`}
          className={cn(
            "group/agenda relative flex touch-pan-y items-center pl-8 lg:touch-none",
            transitions.get(t.id)?.animationClass,
            dragState?.nestTargetId === t.id &&
              (dragState.nestBlockReason ? "ring-2 ring-muted-foreground/40" : "ring-2 ring-brand"),
          )}
          {...getDragHandlers(t.id, t.title, nestBlockReasonFor(t))}
        >
          {reorderable && (
            <button
              type="button"
              aria-label={`Reorder ${t.title}`}
              className="absolute -left-2 flex size-10 cursor-grab touch-none items-center justify-center rounded text-subtle hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              {...getReorderHandlers(t.id, t.title)}
            >
              <GripVertical className="size-4" />
            </button>
          )}
          <ul className="min-w-0 flex-1">
            <TaskItem
              task={t}
              size="large"
              highlight={highlight}
              {...taskItemHandlers(t.id, actions)}
              onSelect={onSelectTask && (() => onSelectTask(t.id))}
            />
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={agendaZoneRef}
      data-testid="day-agenda"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card/50"
    >
      <div
        data-testid="day-agenda-scroll"
        className="thin-scrollbar min-h-0 flex-1 touch-pan-y space-y-6 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch] sm:p-6"
      >
        {allDayToDo.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3 pl-8">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                All Day To-Do
              </h3>
              <span
                aria-label={`All Day To-Do: ${allDayToDo.length}`}
                className="text-xs font-semibold tabular-nums text-brand"
              >
                {allDayToDo.length}
              </span>
            </div>
            <div ref={reorderContainerRef} data-testid="all-day-todo-list" className="space-y-3">
              {allDayToDo.map((t) => renderCard(t, undefined, true))}
              {reorderDragState && reorderDragState.insideList && reorderDragState.insertBeforeId === null && (
                <div data-testid="reorder-indicator" className="h-0.5 rounded-full bg-brand" />
              )}
            </div>
          </section>
        )}
        {nextUp.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center gap-3 pl-8">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Next Up
              </h3>
            </div>
            <div className="space-y-3">
              {nextUp.map((t) =>
                renderCard(
                  t,
                  isViewingToday
                    ? isPastToday(t.time!, date, today, currentTime, t.durationMinutes)
                      ? "overdue"
                      : "pending"
                    : undefined,
                ),
              )}
            </div>
          </section>
        )}
        {doneToday.length > 0 && (
          <section>
            <div className="mb-4 flex shrink-0 items-center gap-3 pl-8">
              <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
                Done Today
              </h3>
            </div>
            <div className="space-y-3">{doneToday.map((t) => renderCard(t))}</div>
          </section>
        )}
      </div>
      <div
        data-testid="day-agenda-footer"
        className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6"
      >
        <div className="pl-8">
          <QuickAdd
            onAdd={(title) => addTask(title, scope)}
            onAddAndOpen={
              onSelectTask &&
              ((title) => {
                const created = addTask(title, scope);
                if (created) onSelectTask(created.id);
              })
            }
            placeholder="New task"
            ariaLabel="Add task"
            variant="panel-footer"
          />
        </div>
      </div>
    </div>
  );
}
