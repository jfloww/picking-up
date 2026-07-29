"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayLabel } from "../lib/dates";
import { ScopeTasks } from "./scope-tasks";

export function DayAgendaDrawer({
  date,
  onClose,
  onOpenDaily,
  onSelectTask,
}: {
  date: string;
  onClose: () => void;
  onOpenDaily: () => void;
  onSelectTask: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      data-testid="day-agenda-drawer"
      aria-label={`Tasks for ${dayLabel(date)}`}
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-card shadow-2xl transition-transform duration-200 ease-out",
        "sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[400px] sm:border-l sm:border-border",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-6">
        <h2 className="min-w-0 truncate text-[15px] font-semibold">{dayLabel(date)}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenDaily}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            Open Daily
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <ScopeTasks
          scope={{ kind: "day", date }}
          quickAdd
          highlightOverdue
          showRepeatLabel
          onSelectTask={onSelectTask}
        />
      </div>
    </aside>
  );
}
