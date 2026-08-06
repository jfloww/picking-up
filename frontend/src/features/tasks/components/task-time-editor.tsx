"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { addMinutesToTime, timeToMinutes } from "../lib/times";

export function TaskTimeEditor({
  time,
  onTimeChange,
  durationMinutes,
  onDurationChange,
  variant = "default",
}: {
  time?: string;
  onTimeChange: (time?: string) => void;
  durationMinutes?: number;
  onDurationChange: (durationMinutes?: number) => void;
  variant?: "default" | "drawer";
}) {
  const drawer = variant === "drawer";
  const endTime = time && durationMinutes ? addMinutesToTime(time, durationMinutes) : "";

  // Start always updates. If an End was already set, keep End's absolute
  // clock time fixed (recompute duration) rather than sliding End with
  // Start — matches how people think in Start/End terms, not duration
  // terms. If the new Start would land at or after that End, the
  // duration clears instead of going negative or blocking the edit —
  // Start must always be freely re-timeable.
  function handleStartChange(newTime: string | undefined) {
    onTimeChange(newTime);
    if (newTime && time && durationMinutes !== undefined) {
      const oldEnd = addMinutesToTime(time, durationMinutes);
      const newDuration = timeToMinutes(oldEnd) - timeToMinutes(newTime);
      onDurationChange(newDuration > 0 ? newDuration : undefined);
    }
  }

  // End's displayed value is always derived from time+durationMinutes,
  // never buffered locally — so an invalid pick (at or before Start)
  // simply isn't committed, and the field reverts to the last valid End
  // on the next render. No error message needed.
  function handleEndChange(newEnd: string) {
    if (!newEnd || !time) return;
    const duration = timeToMinutes(newEnd) - timeToMinutes(time);
    if (duration <= 0) return;
    onDurationChange(duration);
  }

  const endInput = (
    <input
      type="time"
      min={time}
      value={endTime}
      onChange={(e) => handleEndChange(e.target.value)}
      aria-label="Task end time"
      className={cn(
        "rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50",
        drawer ? "w-full min-w-0 flex-1 border-none bg-transparent p-0 text-sm focus-visible:ring-0" : "w-24",
      )}
    />
  );

  if (drawer) {
    const fieldLabelClass = "text-[11px] font-medium text-subtle";
    return (
      <div className={cn("grid gap-3", time ? "grid-cols-[minmax(0,3fr)_minmax(0,5fr)]" : "grid-cols-1")}>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Start</span>
          <input
            type="time"
            value={time ?? ""}
            onChange={(e) => handleStartChange(e.target.value || undefined)}
            aria-label="Task time"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        {time && (
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>End</span>
            <div className="flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring/50">
              {endInput}
              <button
                type="button"
                onClick={() => onTimeChange(undefined)}
                aria-label="Clear duration"
                className="flex size-5 shrink-0 items-center justify-center rounded text-subtle transition-colors duration-200 hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </label>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1">
        <input
          type="time"
          value={time ?? ""}
          onChange={(e) => handleStartChange(e.target.value || undefined)}
          aria-label="Task time"
          className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      {time && <label className="flex flex-col gap-1">{endInput}</label>}
      {time && (
        <button
          type="button"
          onClick={() => onTimeChange(undefined)}
          className="text-xs text-subtle hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
