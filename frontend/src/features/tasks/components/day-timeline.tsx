"use client";

import { useEffect } from "react";

import { cn } from "@/lib/utils";

import { todayKey } from "../lib/dates";
import { nestBlockReasonFor, type NestBlockReason } from "../lib/nesting";
import { compareTasksForDay, isPastToday, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { TaskItem, taskItemHandlers } from "./task-item";
import type { DragState } from "./use-drag-to-schedule";

export const HOUR_HEIGHT = 64; // px per hour, matching the Focus Planner grid
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const VIEWPORT_HOURS = 12; // hours visible in the rail's scroll viewport at once
const VIEWPORT_HEIGHT = VIEWPORT_HOURS * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // fallback start for non-today dates
const BACKGROUND_LANE_WIDTH = 96; // px; only reserved when a background task exists that day
const BACKGROUND_LANE_GAP = 8;

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

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

export function DayTimeline({
  date,
  onSelectTask,
  railRef,
  getDragHandlers,
  dragState,
  scrollActivationKey,
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  railRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
  dragState: DragState | null;
  /** Re-center after a responsive layout makes a previously hidden rail visible. */
  scrollActivationKey?: string;
}) {
  const actions = useTasks();
  const { tasks } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const timed = tasks.filter((t) => scopeKey(t.scope) === key && t.time).sort(compareTasksForDay);
  const activeTimedCount = timed.filter((task) => !task.done).length;
  const backgroundTimed = timed.filter((t) => t.background);
  const regularTimed = timed.filter((t) => !t.background);
  const hasBackgroundLane = backgroundTimed.length > 0;
  const today = todayKey();
  const isToday = date === today;
  const currentTime = nowTime();

  useEffect(() => {
    const railEl = railRef.current;
    if (!railEl) return;
    const viewportHeight = railEl.clientHeight || VIEWPORT_HEIGHT;
    if (isToday) {
      const target = toOffset(currentTime) - viewportHeight / 2;
      railEl.scrollTop = Math.min(Math.max(target, 0), RAIL_HEIGHT - viewportHeight);
    } else {
      railEl.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date, isToday, railRef, currentTime, scrollActivationKey]);

  return (
    <div data-testid="day-timeline" className="flex h-full min-h-0 flex-col bg-background">
      <header
        data-testid="timeline-header"
        className="hidden shrink-0 items-end justify-between border-b border-border/60 px-10 pt-10 pb-6 sm:flex"
      >
        <div>
          <h3 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">
            Focus Agenda
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeTimedCount === 0
              ? "No timed tasks scheduled"
              : `${activeTimedCount} ${activeTimedCount === 1 ? "task" : "tasks"} scheduled today`}
          </p>
        </div>
      </header>

      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative min-h-0 flex-1 overflow-y-auto bg-background"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: `100% ${HOUR_HEIGHT}px`,
        }}
      >
        <div className="relative" style={{ height: RAIL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="absolute inset-x-0"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              <span className="absolute top-2 left-4 text-[11px] leading-4 tabular-nums text-subtle select-none sm:left-10 sm:text-[12px]">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          ))}

          {isToday && (
            <div
              data-testid="now-line"
              className="absolute right-4 left-[72px] z-10 border-t-2 border-brand sm:right-10 sm:left-[104px]"
              style={{ top: toOffset(currentTime) }}
            />
          )}

          <div className="absolute inset-y-0 right-4 left-[72px] sm:right-10 sm:left-[104px]">
            {hasBackgroundLane && (
              <div
                data-testid="background-lane"
                className="absolute inset-y-0 left-0"
                style={{ width: BACKGROUND_LANE_WIDTH }}
              >
                {backgroundTimed.map((t) => {
                  const highlight =
                    isToday && !t.done
                      ? isPastToday(t.time!, date, today, currentTime, t.durationMinutes)
                        ? "overdue"
                        : "pending"
                      : undefined;
                  return (
                    <div
                      key={t.id}
                      data-testid={`chip-${t.id}`}
                      className={cn(
                        "absolute inset-x-1 z-10 min-h-12 touch-none overflow-hidden rounded-md border border-border/60 bg-muted/40 opacity-80 transition-colors hover:bg-muted/70 focus-within:z-30",
                        t.done && "opacity-40",
                      )}
                      style={{
                        top: toOffset(t.time!),
                        height: t.durationMinutes
                          ? (t.durationMinutes * HOUR_HEIGHT) / 60
                          : undefined,
                      }}
                      {...getDragHandlers(t.id, t.title, nestBlockReasonFor(t))}
                    >
                      <ul>
                        <TaskItem
                          task={t}
                          size="timeline"
                          highlight={highlight}
                          {...taskItemHandlers(t.id, actions)}
                          onSelect={onSelectTask && (() => onSelectTask(t.id))}
                        />
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              data-testid="regular-lane"
              className="absolute inset-y-0 right-0"
              style={{ left: hasBackgroundLane ? BACKGROUND_LANE_WIDTH + BACKGROUND_LANE_GAP : 0 }}
            >
              {layoutTimedTasks(regularTimed).map(({ task: t, column, columns }) => {
                const highlight =
                  isToday && !t.done
                    ? isPastToday(t.time!, date, today, currentTime, t.durationMinutes)
                      ? "overdue"
                      : "pending"
                    : undefined;
                return (
                  <div
                    key={t.id}
                    data-testid={`chip-${t.id}`}
                    className={cn(
                      "absolute z-20 min-h-12 touch-none overflow-hidden rounded-r-lg border-l-2 bg-card transition-colors hover:bg-muted focus-within:z-30",
                      t.done
                        ? "border-l-muted-foreground bg-muted/10 opacity-60"
                        : highlight === "overdue"
                          ? "border-l-destructive bg-destructive/10"
                          : highlight === "pending"
                            ? "border-l-warning bg-warning/10"
                            : "border-l-muted-foreground",
                    )}
                    style={{
                      top: toOffset(t.time!),
                      left: `calc(${(column / columns) * 100}% + 2px)`,
                      width: `calc(${100 / columns}% - 4px)`,
                      height: t.durationMinutes
                        ? (t.durationMinutes * HOUR_HEIGHT) / 60
                        : undefined,
                    }}
                    {...getDragHandlers(t.id, t.title, nestBlockReasonFor(t))}
                  >
                    <ul>
                      <TaskItem
                        task={t}
                        size="timeline"
                        highlight={highlight}
                        {...taskItemHandlers(t.id, actions)}
                        onSelect={onSelectTask && (() => onSelectTask(t.id))}
                      />
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {dragState?.previewTime && (
            <div
              data-testid="drag-preview-line"
              className="pointer-events-none absolute right-4 left-[72px] z-40 border-t-2 border-dashed border-brand sm:right-10 sm:left-[104px]"
              style={{ top: toOffset(dragState.previewTime) }}
            >
              <span className="bg-brand px-1 text-[10px] text-primary-foreground">
                {dragState.previewTime}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
