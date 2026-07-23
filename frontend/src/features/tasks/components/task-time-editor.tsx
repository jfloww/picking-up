"use client";

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
  const fieldLabelClass = "text-[11px] font-medium text-subtle";

  return (
    <div className={cn("flex items-end gap-2", drawer && "flex-wrap gap-4")}>
      <label className={cn("flex flex-col gap-1", drawer && "gap-1.5")}>
        {drawer && <span className={fieldLabelClass}>Start</span>}
        <input
          type="time"
          value={time ?? ""}
          onChange={(e) => onTimeChange(e.target.value || undefined)}
          aria-label="Task time"
          className={cn(
            "rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "px-2.5 py-1.5 text-sm",
          )}
        />
      </label>
      {time && (
        <label className={cn("flex flex-col gap-1", drawer && "gap-1.5")}>
          {drawer && <span className={fieldLabelClass}>Duration</span>}
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              step={5}
              list={durationPresetsId}
              value={durationMinutes ?? ""}
              onChange={(e) =>
                onDurationChange(e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="Duration"
              aria-label="Task duration"
              className={cn(
                "w-16 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                drawer && "w-20 px-2.5 py-1.5 text-sm",
              )}
            />
            <span className={cn("text-xs text-subtle", drawer && "text-sm")}>min</span>
            <datalist id={durationPresetsId}>
              {DURATION_PRESETS.map(({ minutes, label }) => (
                <option key={minutes} value={minutes}>
                  {label}
                </option>
              ))}
            </datalist>
          </div>
        </label>
      )}
      {time && (
        <button
          type="button"
          onClick={() => onTimeChange(undefined)}
          className={cn(
            "text-xs text-subtle hover:text-foreground",
            drawer && "pb-1.5 text-sm hover:underline",
          )}
        >
          Clear
        </button>
      )}
    </div>
  );
}
