"use client";

import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { label: "Su", fullName: "Sunday" },
  { label: "Mo", fullName: "Monday" },
  { label: "Tu", fullName: "Tuesday" },
  { label: "We", fullName: "Wednesday" },
  { label: "Th", fullName: "Thursday" },
  { label: "Fr", fullName: "Friday" },
  { label: "Sa", fullName: "Saturday" },
];

export function TaskRepeatPicker({
  weekdays,
  onChange,
}: {
  weekdays: number[];
  onChange: (weekdays: number[]) => void;
}) {
  const toggle = (day: number) => {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Repeat on">
      {WEEKDAYS.map(({ label, fullName }, day) => {
        const active = weekdays.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={active}
            aria-label={`Repeat on ${fullName}`}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-[10px] font-medium",
              active
                ? "bg-brand text-primary-foreground"
                : "bg-muted text-subtle hover:bg-muted/70",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
