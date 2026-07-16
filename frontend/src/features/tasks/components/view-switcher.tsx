"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const VIEWS = ["daily", "weekly", "monthly", "yearly"] as const;
export type ViewKind = (typeof VIEWS)[number];

const VIEW_LABELS: Record<ViewKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export function ViewSwitcher({
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: {
  view: ViewKind;
  onViewChange: (view: ViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div
        role="tablist"
        aria-label="Calendar scale"
        className="flex rounded-lg border border-border p-0.5"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              view === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onPrev} aria-label="Previous">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="icon" onClick={onNext} aria-label="Next">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
