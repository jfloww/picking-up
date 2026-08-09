"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayLabel } from "../lib/dates";
import { useTasks } from "../store";
import { QuickAdd } from "./quick-add";
import { ScopeTasks } from "./scope-tasks";
import { useFocusTrap, useRestoreFocusOnUnmount } from "./use-focus-trap";

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
  const { addTask } = useTasks();
  const asideRef = useRef<HTMLElement>(null);

  useFocusTrap(asideRef, true);
  useRestoreFocusOnUnmount(asideRef);

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
      ref={asideRef}
      data-testid="day-agenda-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={`Tasks for ${dayLabel(date)}`}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-card shadow-2xl transition-transform duration-200 ease-out",
        "sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[400px] sm:border-l sm:border-border",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)] sm:h-[72px] sm:px-6 sm:pt-0">
        <h2 className="min-w-0 truncate text-[15px] font-semibold">{dayLabel(date)}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenDaily}
            className="min-h-11 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted sm:min-h-0"
          >
            Open Daily
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground sm:size-8"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <ScopeTasks
          scope={{ kind: "day", date }}
          highlightOverdue
          showRepeatLabel
          onSelectTask={onSelectTask}
        />
      </div>
      <footer className="shrink-0 border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-6">
        <QuickAdd
          onAdd={(title) => addTask(title, { kind: "day", date })}
          onAddAndOpen={(title) => {
            const created = addTask(title, { kind: "day", date });
            if (created) onSelectTask(created.id);
          }}
          placeholder="New task"
          ariaLabel={`Add task for ${dayLabel(date)}`}
          variant="panel-footer"
        />
      </footer>
    </aside>
  );
}
