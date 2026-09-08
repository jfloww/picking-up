"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Bucket List is temporarily disabled — omitted from VIEWS so its tab
// doesn't render, but kept in ViewKind so every other component that
// switches on it (task-calendar.tsx's VIEW_COMPONENTS/shiftAnchor/
// dateLabelFor, drill-down targets) still type-checks untouched. Re-enable
// by adding "bucket" back to VIEWS (and restoring its task-calendar.test.tsx
// tab-click test).
export const VIEWS = ["daily", "weekly", "monthly"] as const;
export type ViewKind = "daily" | "weekly" | "monthly" | "bucket";

const VIEW_LABELS: Record<ViewKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  bucket: "Bucket List",
};

export function ViewSwitcher({
  view,
  leading,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: {
  view: ViewKind;
  leading?: ReactNode;
  onViewChange: (view: ViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      {leading}
      <div
        role="tablist"
        aria-label="Calendar scale"
        className="col-span-2 row-start-2 flex w-fit rounded-lg border border-border bg-card p-1 lg:col-span-1 lg:col-start-2 lg:row-start-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              view === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      {view !== "bucket" && (
        <div className="col-start-2 row-start-1 flex shrink-0 items-center justify-self-end rounded-lg border border-border bg-card p-1 lg:col-start-3">
          <Button variant="ghost" size="icon" className="size-8" onClick={onPrev} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-3" onClick={onToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={onNext} aria-label="Next">
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
