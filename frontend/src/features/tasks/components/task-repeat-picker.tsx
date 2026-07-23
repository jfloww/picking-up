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
  drawer = false,
}: {
  weekdays: number[];
  onChange: (weekdays: number[]) => void;
  drawer?: boolean;
}) {
  const toggle = (day: number) => {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div
      className={cn("flex items-center gap-1", drawer && "gap-1.5")}
      role="group"
      aria-label="Repeat on"
    >
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
              "flex items-center justify-center rounded-md font-medium transition-colors",
              drawer ? "size-8 text-xs" : "size-6 text-[10px]",
              active
                ? "bg-brand font-semibold text-primary-foreground"
                : cn(
                    "bg-muted hover:bg-muted/70",
                    drawer ? "text-muted-foreground" : "text-subtle",
                  ),
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
