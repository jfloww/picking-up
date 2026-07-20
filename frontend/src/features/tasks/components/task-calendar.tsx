"use client";

import { useState } from "react";

import {
  addDays,
  monthKeyOf,
  nextMonthKey,
  prevMonthKey,
  todayKey,
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
    case "weekly": {
      const month =
        dir === 1
          ? nextMonthKey(monthKeyOf(anchor))
          : prevMonthKey(monthKeyOf(anchor));
      return `${month}-01`;
    }
    case "monthly":
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

function CalendarInner() {
  const { loaded } = useTasks();
  const [view, setView] = useState<ViewKind>("weekly");
  const [anchor, setAnchor] = useState(() => todayKey());

  // Nothing date-dependent renders before the client loads tasks, which
  // keeps server and client markup identical during hydration.
  if (!loaded) return <div aria-busy="true" className="min-h-64" />;

  const View = VIEW_COMPONENTS[view];
  return (
    <div className="space-y-4">
      <ViewSwitcher
        view={view}
        onViewChange={setView}
        onToday={() => setAnchor(todayKey())}
        onPrev={() => setAnchor((a) => shiftAnchor(view, a, -1))}
        onNext={() => setAnchor((a) => shiftAnchor(view, a, 1))}
      />
      <View anchor={anchor} onAnchorChange={setAnchor} />
    </div>
  );
}

export function TaskCalendar() {
  return (
    <TasksProvider>
      <CalendarInner />
    </TasksProvider>
  );
}
