"use client";

import { cn } from "@/lib/utils";

export function TaskDueDateEditor({
  dueDate,
  onDueDateChange,
  variant = "default",
}: {
  dueDate?: string;
  onDueDateChange: (dueDate?: string) => void;
  variant?: "default" | "drawer";
}) {
  const drawer = variant === "drawer";
  return (
    <label className={cn("flex flex-col gap-1", drawer && "gap-1.5")}>
      {drawer && <span className="text-[11px] font-medium text-subtle">Due date</span>}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dueDate ?? ""}
          onChange={(e) => onDueDateChange(e.target.value || undefined)}
          aria-label="Due date"
          className={cn(
            "rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            drawer && "px-2.5 py-1.5 text-sm",
          )}
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => onDueDateChange(undefined)}
            className={cn(
              "text-xs text-subtle hover:text-foreground",
              drawer && "text-sm hover:underline",
            )}
          >
            Clear
          </button>
        )}
      </div>
    </label>
  );
}
