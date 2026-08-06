# Task Time Editor: Start/End Instead of Start/Duration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `TaskTimeEditor`'s numeric Duration-minutes input with an End time picker, in both variants, with zero prop-interface changes.

**Architecture:** `TaskTimeEditor`'s public props (`time`/`onTimeChange`/`durationMinutes`/`onDurationChange`) are unchanged — Start and `durationMinutes` remain the real stored fields. "End" is a value derived inside the component (`addMinutesToTime`/`timeToMinutes`, both already in `lib/times.ts`), so no other production file changes. Several existing tests elsewhere in the codebase exercise the old numeric duration input directly (by aria-label and a bare-number value) and need updating to the new time-based interaction — those are test-only changes, not integration changes.

**Tech Stack:** Next.js/React 19 (existing), Vitest + `@testing-library/react` (existing) — no new dependencies.

## Global Constraints

- No new `Task` field, no new store action.
- Both variants (`default`/compact and `drawer`) get the same Start/End treatment.
- Presets (`DURATION_PRESETS`, the datalist) are removed entirely, not replaced with quick-fill buttons.
- Invalid End (at or before Start) is rejected silently — no error message, no new UI vocabulary.
- Editing Start preserves End's absolute clock time (recomputing duration), except when the new Start would land at or after the existing End, in which case Start still updates but the duration clears.
- `aria-label="Task time"` (Start) is unchanged — many unrelated tests across the codebase already query it. The new End input's `aria-label` is `"Task end time"`. The existing `aria-label="Clear duration"` button (which clears the *whole* scheduled time, not just duration — pre-existing behavior) keeps its label unchanged.

---

### Task 1: Start/End editor + every dependent test

**Files:**
- Modify: `frontend/src/features/tasks/components/task-time-editor.tsx`
- Modify: `frontend/src/features/tasks/components/task-time-editor.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- `TaskTimeEditor`'s props are unchanged (see Architecture above) — this task touches no other production file.

- [ ] **Step 1: Replace `task-time-editor.test.tsx` with the new test suite**

Replace the full contents of `frontend/src/features/tasks/components/task-time-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskTimeEditor } from "./task-time-editor";

const noopHandlers = {
  onTimeChange: () => {},
  onDurationChange: () => {},
};

describe("TaskTimeEditor", () => {
  it("renders the time input with the given value", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task time") as HTMLInputElement).value).toBe("14:00");
  });

  it("calls onTimeChange with the new value on change", () => {
    const onTimeChange = vi.fn();
    render(<TaskTimeEditor time="14:00" {...noopHandlers} onTimeChange={onTimeChange} />);
    fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
  });

  it("shows Clear only when a time is set, and calls onTimeChange(undefined) from it", () => {
    const onTimeChange = vi.fn();
    const { rerender } = render(<TaskTimeEditor {...noopHandlers} onTimeChange={onTimeChange} />);
    expect(screen.queryByText("Clear")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" {...noopHandlers} onTimeChange={onTimeChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onTimeChange).toHaveBeenCalledWith(undefined);
  });

  it("shows the end-time input only when a time is set", () => {
    const { rerender } = render(<TaskTimeEditor {...noopHandlers} />);
    expect(screen.queryByLabelText("Task end time")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect(screen.getByLabelText("Task end time")).toBeTruthy();
  });

  it("is a time input, not a number", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).type).toBe("time");
  });

  it("derives End from Start + durationMinutes", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).value).toBe("15:30");
  });

  it("defaults to an empty End when durationMinutes is unset", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).value).toBe("");
  });

  it("calls onDurationChange with the minutes between Start and a valid new End", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "15:00" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);
  });

  it("rejects an End at or before Start — does not call onDurationChange", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "13:30" } }); // before Start
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "14:00" } }); // equal to Start
    expect(onDurationChange).not.toHaveBeenCalled();
  });

  it("has a min attribute on End matching Start, as a native-picker hint", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).min).toBe("14:00");
  });

  describe("editing Start", () => {
    it("keeps End's clock time fixed, recomputing duration", () => {
      const onDurationChange = vi.fn();
      render(
        <TaskTimeEditor
          time="14:00"
          durationMinutes={60} // End = 15:00
          {...noopHandlers}
          onDurationChange={onDurationChange}
        />,
      );
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "14:30" } });
      expect(onDurationChange).toHaveBeenCalledWith(30); // 14:30 -> 15:00
    });

    it("clears the duration if the new Start would be at or after the existing End", () => {
      const onDurationChange = vi.fn();
      render(
        <TaskTimeEditor
          time="14:00"
          durationMinutes={60} // End = 15:00
          {...noopHandlers}
          onDurationChange={onDurationChange}
        />,
      );
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:00" } });
      expect(onDurationChange).toHaveBeenCalledWith(undefined);
    });

    it("does not touch duration when no duration was set yet", () => {
      const onDurationChange = vi.fn();
      render(<TaskTimeEditor time="14:00" {...noopHandlers} onDurationChange={onDurationChange} />);
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:00" } });
      expect(onDurationChange).not.toHaveBeenCalled();
    });
  });

  describe("drawer variant", () => {
    it("lays out Start narrower than End, roughly 38/62, not an even 50/50 split", () => {
      render(<TaskTimeEditor time="14:00" {...noopHandlers} variant="drawer" />);
      const grid = screen.getByLabelText("Task time").closest("div.grid");
      expect(grid!.className).toContain("grid-cols-[minmax(0,3fr)_minmax(0,5fr)]");
    });

    it("has no separate 'Clear' text button — clearing lives inside the End field", () => {
      render(<TaskTimeEditor time="14:00" {...noopHandlers} variant="drawer" />);
      expect(screen.queryByText("Clear")).toBeNull();
      expect(screen.getByLabelText("Clear duration")).toBeTruthy();
    });

    it("Clear duration clears the whole scheduled time, same as the old Clear button", () => {
      const onTimeChange = vi.fn();
      render(
        <TaskTimeEditor time="14:00" {...noopHandlers} onTimeChange={onTimeChange} variant="drawer" />,
      );
      fireEvent.click(screen.getByLabelText("Clear duration"));
      expect(onTimeChange).toHaveBeenCalledWith(undefined);
    });

    it("hides the End field and its clear control when no time is set", () => {
      render(<TaskTimeEditor {...noopHandlers} variant="drawer" />);
      expect(screen.queryByLabelText("Task end time")).toBeNull();
      expect(screen.queryByLabelText("Clear duration")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-time-editor.test.tsx`
Expected: FAIL — `screen.getByLabelText("Task end time")` finds nothing yet (the component still has the old numeric "Task duration" input).

- [ ] **Step 3: Replace `task-time-editor.tsx`**

Replace the full contents of `frontend/src/features/tasks/components/task-time-editor.tsx`:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-time-editor.test.tsx`
Expected: PASS (16/16)

- [ ] **Step 5: Update `task-detail-fields.test.tsx`**

Replace the existing `"threads durationMinutes and onDurationChange to TaskTimeEditor"` test (search for it — it's the last test in the file, right before the closing `});` of its `describe` block):

```tsx
  it("threads durationMinutes and onDurationChange to TaskTimeEditor", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ time: "14:00", durationMinutes: 30 })}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    const input = screen.getByLabelText("Task end time") as HTMLInputElement;
    expect(input.value).toBe("14:30");
    fireEvent.change(input, { target: { value: "15:00" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);
  });
```

- [ ] **Step 6: Update `primitives.test.tsx`**

Replace the existing `"threads onDurationChange to the inline TaskDetailFields expansion"` test:

```tsx
  it("threads onDurationChange to the inline TaskDetailFields expansion", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist", time: "09:00" })}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "09:45" } });
    expect(onDurationChange).toHaveBeenCalledWith(45);
  });
```

- [ ] **Step 7: Update `task-detail-drawer.test.tsx`**

Replace the `"shows exactly one duration select, next to the time, not duplicated"` test:

```tsx
  it("shows exactly one end-time input, next to Start, not duplicated", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task end time")).toHaveLength(1);
  });
```

In the `"does not call any commit handler immediately when the checkbox, priority, background, duration, time, memo, or repeat are edited"` test, replace these two lines:

```tsx
      fireEvent.change(screen.getByLabelText("Task duration"), { target: { value: "45" } });
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
```

with:

```tsx
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
      fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "11:15" } });
```

In the `"Done commits every edited field and then closes"` test, replace the same two lines the same way:

```tsx
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
      fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "11:15" } });
```

(Its existing assertions — `expect(handlers.onDurationChange).toHaveBeenCalledWith(45)` and `expect(handlers.onTimeChange).toHaveBeenCalledWith("10:30")` — need no changes: Start moves to 10:30 first while no duration exists yet, so `handleStartChange` doesn't touch duration; End then moves to 11:15, which is 45 minutes after the *new* Start, 10:30.)

Replace the `"hides Start, Duration, and Repeat"` test:

```tsx
  it("hides Start, End, and Repeat", () => {
    render(<TaskDetailDrawer task={bucketTask} {...noopHandlers} />);
    expect(screen.queryByLabelText("Task time")).toBeNull();
    expect(screen.queryByLabelText("Task end time")).toBeNull();
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
  });
```

- [ ] **Step 8: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — every file touched in this task, plus no regressions anywhere else (e.g. `formatTaskTimeRange`'s display tests in `task-item.test.tsx`/`primitives.test.tsx` are unaffected since that's a separate, read-only display function untouched by this change).

- [ ] **Step 9: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Manual verification in the browser**

Start the dev server (`cd frontend && npm run dev`) and, on a task with a time set (in both the compact inline editor and the full detail drawer):
- Confirm Start and End both show as native time pickers, no "min" number field, no dropdown of presets.
- Set an End earlier than Start — confirm it's rejected (the field snaps back, no console error, no crash).
- With Start=9:00 and End=10:00 already set, change Start to 9:30 — confirm End stays 10:00 (duration becomes 30m, verify via the task's displayed time range elsewhere, e.g. its agenda card).
- With the same task, change Start to 10:00 (at or past the existing End) — confirm End/duration clears rather than showing something nonsensical.
- Confirm the native time picker's clock icon / hour-minute wheel still works normally for both fields.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/tasks/components/task-time-editor.tsx frontend/src/features/tasks/components/task-time-editor.test.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx frontend/src/features/tasks/components/primitives.test.tsx
git commit -m "feat: replace duration-minutes input with an End time picker"
```
