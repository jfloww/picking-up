"use client";

import { useEffect, useRef } from "react";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, layoutTimedTasks, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";
import { useDragToSchedule } from "./use-drag-to-schedule";

export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // mornings visible by default

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

export function DayTimeline({ date }: { date: string }) {
  const actions = useTasks();
  const { tasks, addTask, setTime } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);
  const allDay = dayTasks.filter((t) => !t.time);
  const timed = dayTasks.filter((t) => t.time).sort(compareTasksForDay);
  const isToday = date === todayKey();

  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (railRef.current) {
      railRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date]);

  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
  });

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div ref={allDayZoneRef} data-testid="all-day-zone">
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          All-day
        </div>
        <div className="space-y-1">
          {allDay.map((t) => (
            <div key={t.id} data-testid={`all-day-${t.id}`} {...getDragHandlers(t.id, t.title)}>
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}
        </div>
        <QuickAdd onAdd={(title) => addTask(title, scope)} />
      </div>

      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative max-h-96 min-h-48 overflow-y-auto rounded-md border border-border/60"
      >
        <div className="relative" style={{ height: RAIL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/40"
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
              style={{ top: toOffset(nowTime()) }}
            />
          )}

          {layoutTimedTasks(timed).map(({ task: t, column, columns }) => (
            <div
              key={t.id}
              data-testid={`chip-${t.id}`}
              className="absolute z-20 rounded-md bg-brand/10 px-1 ring-1 ring-brand/30 focus-within:z-30"
              style={{
                top: toOffset(t.time!),
                left: `calc(${(column / columns) * 100}% + 2px)`,
                width: `calc(${100 / columns}% - 4px)`,
              }}
              {...getDragHandlers(t.id, t.title)}
            >
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}

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

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: (railRef.current?.getBoundingClientRect().left ?? 0) + 8,
          }}
        >
          {dragState.title}
        </div>
      )}
    </div>
  );
}
