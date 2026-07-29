"use client";

import { useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import type { TaskRepository } from "../data/repository";
import {
  addDays,
  dayLabel,
  monthKeyOf,
  monthLabel,
  nextMonthKey,
  prevMonthKey,
  todayKey,
  weekRangeLabel,
  weekStartOf,
  yearOf,
} from "../lib/dates";
import { TasksProvider, useTasks } from "../store";
import { ViewSwitcher, type ViewKind } from "./view-switcher";
import { DailyView } from "./views/daily-view";
import { MonthlyView } from "./views/monthly-view";
import { WeeklyView } from "./views/weekly-view";
import { YearlyView } from "./views/yearly-view";

export function shiftAnchor(
  view: ViewKind,
  anchor: string,
  dir: 1 | -1,
): string {
  switch (view) {
    case "daily":
      return addDays(anchor, dir);
    case "weekly":
      return addDays(anchor, 7 * dir);
    case "monthly":
      return `${dir > 0 ? nextMonthKey(monthKeyOf(anchor)) : prevMonthKey(monthKeyOf(anchor))}-01`;
    case "yearly":
      return `${Number(yearOf(anchor)) + dir}-${anchor.slice(5, 7)}-01`;
  }
}

const VIEW_COMPONENTS = {
  daily: DailyView,
  weekly: WeeklyView,
  monthly: MonthlyView,
  yearly: YearlyView,
} as const;

function dateLabelFor(view: ViewKind, anchor: string): string {
  switch (view) {
    case "daily":
      return dayLabel(anchor);
    case "weekly":
      return weekRangeLabel(weekStartOf(anchor));
    case "monthly":
      return monthLabel(monthKeyOf(anchor));
    case "yearly":
      return yearOf(anchor);
  }
}

function CalendarInner() {
  const { loaded, syncError, dismissSyncError } = useTasks();
  const [view, setView] = useState<ViewKind>("daily");
  const [anchor, setAnchor] = useState(() => todayKey());

  // Nothing date-dependent renders before the client loads tasks, which
  // keeps server and client markup identical during hydration.
  if (!loaded) return <div aria-busy="true" className="min-h-64" />;

  const View = VIEW_COMPONENTS[view];
  const dateLabel = dateLabelFor(view, anchor);
  const weekLabel = `Week of ${weekRangeLabel(weekStartOf(anchor))}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="h-[72px] shrink-0 border-b border-border px-10">
        <ViewSwitcher
          view={view}
          leading={
            <div className="flex min-w-[320px] flex-col">
              <h1 className="text-[20px] leading-7 font-bold tracking-tight">
                {dateLabel}
              </h1>
              <span className="min-h-4 text-[12px] font-medium tracking-wider text-muted-foreground uppercase">
                {view === "daily" ? weekLabel : ""}
              </span>
            </div>
          }
          onViewChange={setView}
          onToday={() => setAnchor(todayKey())}
          onPrev={() => setAnchor((a) => shiftAnchor(view, a, -1))}
          onNext={() => setAnchor((a) => shiftAnchor(view, a, 1))}
        />
      </header>
      {syncError && (
        <div className="shrink-0 px-10 pt-3">
          <Alert variant="destructive">
            <AlertTitle>{syncError}</AlertTitle>
            <AlertAction>
              <button
                type="button"
                onClick={dismissSyncError}
                className="text-xs text-destructive/70 underline hover:text-destructive"
              >
                Dismiss
              </button>
            </AlertAction>
          </Alert>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <View
          anchor={anchor}
          onAnchorChange={setAnchor}
          onDrillDown={(nextView, dateKey) => {
            setView(nextView);
            setAnchor(dateKey);
          }}
        />
      </div>
    </div>
  );
}

export function TaskCalendar({ repository }: { repository?: TaskRepository } = {}) {
  return (
    <TasksProvider repository={repository}>
      <CalendarInner />
    </TasksProvider>
  );
}
