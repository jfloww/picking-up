"use client";

import { useEffect } from "react";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, isPastToday, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { TaskItem, taskItemHandlers } from "./task-item";
import type { DragState } from "./use-drag-to-schedule";

export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const VIEWPORT_HOURS = 12; // hours visible in the rail's scroll viewport at once
const VIEWPORT_HEIGHT = VIEWPORT_HOURS * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // fallback start for non-today dates

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

type GetDragHandlers = (
  id: string,
  title: string,
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
}: {
  date: string;
  onSelectTask?: (id: string) => void;
  railRef: React.RefObject<HTMLDivElement | null>;
  getDragHandlers: GetDragHandlers;
  dragState: DragState | null;
}) {
  const actions = useTasks();
  const { tasks } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const timed = tasks.filter((t) => scopeKey(t.scope) === key && t.time).sort(compareTasksForDay);
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
  }, [date, isToday, railRef, currentTime]);

  return (
    <div
      ref={railRef}
      data-testid="hour-rail"
      className="relative h-full overflow-y-auto rounded-md border border-border/60"
    >
      <div className="relative" style={{ height: RAIL_HEIGHT }}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            key={hour}
            className="absolute inset-x-0 border-t border-border/15"
            style={{ top: hour * HOUR_HEIGHT }}
          >
            <span className="pl-1 text-[10px] tabular-nums text-subtle">
              {String(hour).padStart(2, "0")}:00
            </span>
          </div>
        ))}

        {isToday && (
          <div
            data-testid="now-line"
            className="absolute inset-x-0 z-10 border-t-2 border-brand"
            style={{ top: toOffset(currentTime) }}
          />
        )}

        {layoutTimedTasks(timed).map(({ task: t, column, columns }) => {
          const highlight =
            isToday && !t.done
              ? isPastToday(t.time!, date, today, currentTime)
                ? "overdue"
                : "pending"
              : undefined;
          return (
            <div
              key={t.id}
              data-testid={`chip-${t.id}`}
              className="absolute z-20 touch-none rounded-md bg-brand/10 px-1 ring-1 ring-brand/30 focus-within:z-30"
              style={{
                top: toOffset(t.time!),
                left: `calc(${(column / columns) * 100}% + 2px)`,
                width: `calc(${100 / columns}% - 4px)`,
              }}
              {...getDragHandlers(t.id, t.title)}
            >
              <ul>
                <TaskItem
                  task={t}
                  highlight={highlight}
                  {...taskItemHandlers(t.id, actions)}
                  onSelect={onSelectTask && (() => onSelectTask(t.id))}
                />
              </ul>
            </div>
          );
        })}

        {dragState?.previewTime && (
          <div
            data-testid="drag-preview-line"
            className="pointer-events-none absolute inset-x-0 z-40 border-t-2 border-dashed border-brand"
            style={{ top: toOffset(dragState.previewTime) }}
          >
            <span className="bg-brand px-1 text-[10px] text-primary-foreground">
              {dragState.previewTime}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
