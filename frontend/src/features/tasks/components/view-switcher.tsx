"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

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
    <div className="flex h-full w-full items-center justify-between gap-6">
      <div className="flex min-w-0 items-center gap-8">
        {leading}
        <div
          role="tablist"
          aria-label="Calendar scale"
          className="flex rounded-lg border border-border bg-card p-1"
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
      </div>
      <div className="flex shrink-0 items-center rounded-lg border border-border bg-card p-1">
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
    </div>
  );
}
