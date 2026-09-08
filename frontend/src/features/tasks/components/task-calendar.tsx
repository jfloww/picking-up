"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Columns3, ListTodo } from "lucide-react";
import { useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { FocusHeadliner } from "@/features/focus/components/focus-headliner";
import type { FocusRepository } from "@/features/focus/data/focus-repository";
import { cn } from "@/lib/utils";
import type { CategoryRepository } from "../data/category-repository";
import type { TaskRepository } from "../data/repository";
import {
  DAY_LABELS,
  addDays,
  dayLabel,
  dayOfMonth,
  monthKeyOf,
  monthLabel,
  nextMonthKey,
  prevMonthKey,
  todayKey,
  weekRangeLabel,
  weekDates,
  weekStartOf,
} from "../lib/dates";
import { TasksProvider, useTasks } from "../store";
import { ViewSwitcher, type ViewKind } from "./view-switcher";
import { BucketListView } from "./views/bucket-list-view";
import { DailyView } from "./views/daily-view";
import { MonthlyView } from "./views/monthly-view";
import { WeeklyView } from "./views/weekly-view";

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
    case "bucket":
      return anchor; // no anchor date to page through
  }
}

const VIEW_COMPONENTS = {
  daily: DailyView,
  weekly: WeeklyView,
  monthly: MonthlyView,
  bucket: BucketListView,
} as const;

function dateLabelFor(view: ViewKind, anchor: string): string {
  switch (view) {
    case "daily":
      return dayLabel(anchor);
    case "weekly":
      return weekRangeLabel(weekStartOf(anchor));
    case "monthly":
      return monthLabel(monthKeyOf(anchor));
    case "bucket":
      return "Bucket List";
  }
}

const MOBILE_VIEWS = ["daily", "weekly", "monthly"] as const;
const MOBILE_VIEW_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
} as const;
const MOBILE_VIEW_ICONS = {
  daily: ListTodo,
  weekly: Columns3,
  monthly: CalendarDays,
} as const;

function MobileDateNavigation({
  view,
  anchor,
  onAnchorChange,
  onToday,
  onPrev,
  onNext,
}: {
  view: ViewKind;
  anchor: string;
  onAnchorChange: (date: string) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (view === "bucket") return null;

  const weekStart = weekStartOf(anchor);
  const dates = weekDates(weekStart);
  const mobileLabel = view === "monthly" ? monthLabel(monthKeyOf(anchor)) : weekRangeLabel(weekStart);
  const [month, year] = view === "monthly" ? mobileLabel.split(" ") : [null, null];
  const [weekLabelStart, weekLabelEnd] = mobileLabel.split(" – ");

  return (
    <section
      data-testid="mobile-calendar-navigation"
      className="shrink-0 border-b border-border bg-background px-4 pt-2 pb-3 sm:hidden"
    >
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label={`Previous ${view === "daily" ? "day" : view === "weekly" ? "week" : "month"}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="min-h-11 min-w-0 flex-1 rounded-lg px-2 text-center focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Go to today"
        >
          <span className="block text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">
            <span>To</span><span>day</span>
          </span>
          <span className="block truncate text-[15px] font-bold tracking-tight">
            {view === "monthly" ? (
              <>
                <span>{month}</span> <span>{year}</span>
              </>
            ) : view === "weekly" ? (
              <>
                Week <span>{weekLabelStart}</span>
                <span aria-hidden> – </span>
                <span>{weekLabelEnd}</span>
              </>
            ) : (
              mobileLabel
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label={`Next ${view === "daily" ? "day" : view === "weekly" ? "week" : "month"}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {view !== "monthly" && (
        <div className="mt-2 grid grid-cols-7 gap-1" aria-label="Select date">
          {dates.map((date, index) => {
            const selected = date === anchor;
            const today = date === todayKey();
            return (
              <button
                key={date}
                type="button"
                onClick={() => onAnchorChange(date)}
                aria-label={`Select ${dayLabel(date)}`}
                aria-current={selected ? "date" : undefined}
                className={cn(
                  "flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-xl text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  selected
                    ? "bg-brand text-primary-foreground shadow-sm"
                    : today
                      ? "bg-brand/10 text-brand"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="text-[10px] font-semibold uppercase">{DAY_LABELS[index]}</span>
                <span className="mt-0.5 text-sm font-bold tabular-nums">{dayOfMonth(date)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MobileBottomNavigation({
  view,
  onViewChange,
}: {
  view: ViewKind;
  onViewChange: (view: ViewKind) => void;
}) {
  return (
    <nav
      aria-label="Planner views"
      className="grid shrink-0 grid-cols-3 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {MOBILE_VIEWS.map((nextView) => {
        const Icon = MOBILE_VIEW_ICONS[nextView];
        const selected = view === nextView;
        return (
          <button
            key={nextView}
            type="button"
            onClick={() => onViewChange(nextView)}
            aria-label={`Switch to ${MOBILE_VIEW_LABELS[nextView]} view`}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
              selected ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {MOBILE_VIEW_LABELS[nextView]}
          </button>
        );
      })}
    </nav>
  );
}

function CalendarInner({ focusRepository }: { focusRepository?: FocusRepository }) {
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
      <header className="hidden shrink-0 border-b border-border px-6 py-2 sm:block lg:h-16 lg:py-0">
        <ViewSwitcher
          view={view}
          leading={
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-[20px] leading-7 font-bold tracking-tight" title={dateLabel}>
                {dateLabel}
              </h1>
              {view === "daily" && (
                <span className="truncate text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  {weekLabel}
                </span>
              )}
            </div>
          }
          onViewChange={setView}
          onToday={() => setAnchor(todayKey())}
          onPrev={() => setAnchor((a) => shiftAnchor(view, a, -1))}
          onNext={() => setAnchor((a) => shiftAnchor(view, a, 1))}
        />
      </header>
      <MobileDateNavigation
        view={view}
        anchor={anchor}
        onAnchorChange={setAnchor}
        onToday={() => setAnchor(todayKey())}
        onPrev={() => setAnchor((current) => shiftAnchor(view, current, -1))}
        onNext={() => setAnchor((current) => shiftAnchor(view, current, 1))}
      />
      <FocusHeadliner repository={focusRepository} />
      {syncError && (
        <div className="shrink-0 px-4 pt-3 sm:px-10">
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
      <div className="mt-3 min-h-0 flex-1 overflow-hidden sm:rounded-xl sm:border sm:border-border">
        <View
          anchor={anchor}
          onAnchorChange={setAnchor}
          onDrillDown={(nextView, dateKey) => {
            setView(nextView);
            setAnchor(dateKey);
          }}
        />
      </div>
      <MobileBottomNavigation view={view} onViewChange={setView} />
    </div>
  );
}

export function TaskCalendar({
  repository,
  categoryRepository,
  focusRepository,
}: {
  repository?: TaskRepository;
  categoryRepository?: CategoryRepository;
  focusRepository?: FocusRepository;
} = {}) {
  return (
    <TasksProvider repository={repository} categoryRepository={categoryRepository}>
      <CalendarInner focusRepository={focusRepository} />
    </TasksProvider>
  );
}
