"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 45, label: "45m" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1.5h" },
  { minutes: 120, label: "2h" },
];

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
  const durationPresetsId = useId();
  const drawer = variant === "drawer";

  const durationInput = (
    <input
      type="number"
      min={1}
      step={5}
      list={durationPresetsId}
      value={durationMinutes ?? ""}
      onChange={(e) => onDurationChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder="Duration"
      aria-label="Task duration"
      className={cn(
        "w-16 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50",
        drawer && "w-full min-w-0 flex-1 border-none bg-transparent p-0 text-sm focus-visible:ring-0",
      )}
    />
  );
  const durationDatalist = (
    <datalist id={durationPresetsId}>
      {DURATION_PRESETS.map(({ minutes, label }) => (
        <option key={minutes} value={minutes}>
          {label}
        </option>
      ))}
    </datalist>
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
            onChange={(e) => onTimeChange(e.target.value || undefined)}
            aria-label="Task time"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        {time && (
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Duration</span>
            <div className="flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring/50">
              {durationInput}
              <span className="shrink-0 text-sm text-subtle">min</span>
              <button
                type="button"
                onClick={() => onTimeChange(undefined)}
                aria-label="Clear duration"
                className="flex size-5 shrink-0 items-center justify-center rounded text-subtle transition-colors duration-200 hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
              {durationDatalist}
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
          onChange={(e) => onTimeChange(e.target.value || undefined)}
          aria-label="Task time"
          className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      {time && (
        <label className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            {durationInput}
            <span className="text-xs text-subtle">min</span>
            {durationDatalist}
          </div>
        </label>
      )}
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
