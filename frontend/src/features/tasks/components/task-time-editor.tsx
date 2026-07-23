"use client";

import { useId } from "react";

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
}: {
  time?: string;
  onTimeChange: (time?: string) => void;
  durationMinutes?: number;
  onDurationChange: (durationMinutes?: number) => void;
}) {
  const durationPresetsId = useId();

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={time ?? ""}
        onChange={(e) => onTimeChange(e.target.value || undefined)}
        aria-label="Task time"
        className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {time && (
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
            className="w-16 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <span className="text-xs text-subtle">min</span>
          <datalist id={durationPresetsId}>
            {DURATION_PRESETS.map(({ minutes, label }) => (
              <option key={minutes} value={minutes}>
                {label}
              </option>
            ))}
          </datalist>
        </div>
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
