"use client";

export function TaskTimeEditor({
  time,
  onTimeChange,
}: {
  time?: string;
  onTimeChange: (time?: string) => void;
}) {
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
