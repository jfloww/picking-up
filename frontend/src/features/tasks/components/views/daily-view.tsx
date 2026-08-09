"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

import { todayKey, shortDateLabel, upcomingRepeatDates } from "../../lib/dates";
import { lostFieldsFor, nestBlockMessage, type NestBlockReason } from "../../lib/nesting";
import { resolveRepeatWeekdays } from "../../lib/times";
import { useTasks } from "../../store";
import { ConvertToSubtaskDialog } from "../convert-to-subtask-dialog";
import { DayAgenda } from "../day-agenda";
import { DayTimeline, HOUR_HEIGHT } from "../day-timeline";
import { QuickAdd } from "../quick-add";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import { useDragToSchedule } from "../use-drag-to-schedule";
import type { CalendarViewProps } from "./weekly-view";

const UPCOMING_REPEAT_COUNT = 3;

export function DailyView({ anchor }: CalendarViewProps) {
  const actions = useTasks();
  const { tasks, setTime } = actions;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState<"tasks" | "timeline">("tasks");
  const [pendingConversion, setPendingConversion] = useState<{
    sourceId: string;
    targetId: string;
    sourceTitle: string;
    targetTitle: string;
    lostFields: string[];
  } | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<{ text: string; at: number } | null>(null);

  useEffect(() => {
    if (!blockedMessage) return;
    const timer = setTimeout(() => setBlockedMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [blockedMessage]);

  function handleNest(sourceId: string, targetId: string) {
    const source = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!source || !target) return;
    const lostFields = lostFieldsFor(source);
    if (lostFields.length === 0) {
      actions.convertTaskToSubtask(sourceId, targetId);
      return;
    }
    setPendingConversion({
      sourceId,
      targetId,
      sourceTitle: source.title,
      targetTitle: target.title,
      lostFields,
    });
  }

  function handleNestBlocked(reason: NestBlockReason) {
    setBlockedMessage({ text: nestBlockMessage(reason), at: Date.now() });
  }

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedTaskRepeatWeekdays = selectedTask
    ? resolveRepeatWeekdays(selectedTask, tasks)
    : undefined;
  const selectedTaskUpcomingRepeatDates = selectedTaskRepeatWeekdays
    ? upcomingRepeatDates(selectedTaskRepeatWeekdays, todayKey(), UPCOMING_REPEAT_COUNT).map(
        (date) => shortDateLabel(date, todayKey()),
      )
    : undefined;

  const handleSelectTask = (id: string) =>
    setSelectedTaskId((current) => (current === id ? null : id));

  const railRef = useRef<HTMLDivElement>(null);
  const agendaZoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef: agendaZoneRef,
    cardRefs,
    hourHeight: HOUR_HEIGHT,
    onSchedule: (id, time) => setTime(id, time),
    onNest: handleNest,
    onNestBlocked: handleNestBlocked,
  });

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {blockedMessage && (
          <div className="shrink-0 px-4 pt-3 sm:px-10">
            <Alert variant="destructive">
              <AlertTitle>{blockedMessage.text}</AlertTitle>
              <AlertAction>
                <button
                  type="button"
                  onClick={() => setBlockedMessage(null)}
                  className="text-xs text-destructive/70 underline hover:text-destructive"
                >
                  Dismiss
                </button>
              </AlertAction>
            </Alert>
          </div>
        )}
        <div
          role="tablist"
          aria-label="Daily presentation"
          className="grid shrink-0 grid-cols-2 gap-1 border-b border-border bg-background px-4 py-2 sm:hidden"
        >
          {(["tasks", "timeline"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mobileMode === mode}
              onClick={() => setMobileMode(mode)}
              className={cn(
                "min-h-10 rounded-lg text-sm font-semibold capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                mobileMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {mode === "tasks" ? "Tasks" : "Timeline"}
            </button>
          ))}
        </div>
        <div
          data-testid="daily-layout"
          className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-background sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        >
          <section
            data-testid="timeline-panel"
            aria-label="Daily timeline"
            className={cn(
              "min-h-0 min-w-0 bg-background sm:block sm:border-r sm:border-border",
              mobileMode === "timeline" ? "block" : "hidden",
            )}
          >
            <DayTimeline
              date={anchor}
              onSelectTask={handleSelectTask}
              railRef={railRef}
              getDragHandlers={getDragHandlers}
              dragState={dragState}
              scrollActivationKey={mobileMode}
            />
          </section>
          <aside
            data-testid="agenda-panel"
            aria-label="Daily task list"
            className={cn(
              "min-h-0 min-w-0 bg-card/50 sm:block",
              mobileMode === "tasks" ? "block" : "hidden",
            )}
          >
            <DayAgenda
              date={anchor}
              onSelectTask={handleSelectTask}
              agendaZoneRef={agendaZoneRef}
              getDragHandlers={getDragHandlers}
              cardRefs={cardRefs}
              dragState={dragState}
            />
          </aside>
        </div>
        {mobileMode === "timeline" && (
          <div
            data-testid="mobile-timeline-quick-add"
            className="shrink-0 border-t border-border bg-card px-4 py-2 sm:hidden"
          >
            <QuickAdd
              onAdd={(title) => actions.addTask(title, { kind: "day", date: anchor })}
              onAddAndOpen={(title) => {
                const created = actions.addTask(title, { kind: "day", date: anchor });
                if (created) setSelectedTaskId(created.id);
              }}
              placeholder="New task"
              ariaLabel="Add task"
              variant="panel-footer"
            />
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          upcomingRepeatDates={selectedTaskUpcomingRepeatDates}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}

      {dragState && (
        <div
          data-testid="drag-ghost"
          className="pointer-events-none fixed z-50 rounded-md bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-brand/40"
          style={{
            top: dragState.pointerY + 12,
            left: dragState.pointerX + 12,
          }}
        >
          {dragState.title}
        </div>
      )}

      {pendingConversion && (
        <ConvertToSubtaskDialog
          sourceTitle={pendingConversion.sourceTitle}
          targetTitle={pendingConversion.targetTitle}
          lostFields={pendingConversion.lostFields}
          onConfirm={() => {
            actions.convertTaskToSubtask(
              pendingConversion.sourceId,
              pendingConversion.targetId,
              true,
            );
            setPendingConversion(null);
          }}
          onCancel={() => setPendingConversion(null)}
        />
      )}
    </>
  );
}
