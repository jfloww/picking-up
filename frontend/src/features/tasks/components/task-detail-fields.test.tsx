import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailFields } from "./task-detail-fields";

const noopHandlers = {
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDurationChange: (_durationMinutes?: number) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailFields showTime", () => {
  it("shows the time input by default", () => {
    render(<TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} />);
    expect(screen.getByLabelText("Task time")).toBeTruthy();
  });

  it("skips the time input when showTime is false", () => {
    render(
      <TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} showTime={false} />,
    );
    expect(screen.queryByLabelText("Task time")).toBeNull();
  });

  it("shows upcoming repeat dates when provided, for an editable anchor task", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "day", date: "2026-07-16" }, repeatWeekdays: [1, 3, 5] })}
        {...noopHandlers}
        upcomingRepeatDates={["Fri Jul 17", "Mon Jul 20", "Wed Jul 22"]}
      />,
    );
    expect(screen.getByText(/Fri Jul 17, Mon Jul 20, Wed Jul 22/)).toBeTruthy();
  });

  it("shows upcoming repeat dates when provided, for a read-only generated occurrence", () => {
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatSourceId: "anchor-1",
        })}
        {...noopHandlers}
        upcomingRepeatDates={["Fri Jul 17", "Mon Jul 20"]}
      />,
    );
    expect(screen.getByLabelText("Part of a routine")).toBeTruthy();
    expect(screen.getByText(/Fri Jul 17, Mon Jul 20/)).toBeTruthy();
  });

  it("shows nothing extra when upcomingRepeatDates is omitted or empty", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "day", date: "2026-07-16" }, repeatWeekdays: [1] })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByText(/Next:/)).toBeNull();
  });

  it("threads durationMinutes and onDurationChange to TaskTimeEditor", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ time: "14:00", durationMinutes: 30 })}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    const select = screen.getByLabelText("Task duration") as HTMLSelectElement;
    expect(select.value).toBe("30");
    fireEvent.change(select, { target: { value: "60" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);
  });
});

describe("TaskDetailFields repeat", () => {
  it("shows an editable repeat picker for a day-scoped task with no routine yet", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "day", date: "2026-07-16" } })}
        {...noopHandlers}
      />,
    );
    expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
  });

  it("shows a read-only indicator instead of the picker for a generated occurrence", () => {
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatSourceId: "anchor-1",
        })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
    expect(screen.getByLabelText("Part of a routine")).toBeTruthy();
  });

  it("hides the repeat row entirely for a non-day-scoped task", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "week", weekStart: "2026-07-12" } })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
    expect(screen.queryByLabelText("Part of a routine")).toBeNull();
  });

  it("calls onRepeatWeekdaysChange when toggling a day", () => {
    const onRepeatWeekdaysChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatWeekdays: [1],
        })}
        {...noopHandlers}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onRepeatWeekdaysChange).toHaveBeenCalledWith([1, 3]);
  });

  it("keeps the repeat picker editable after the anchor rolls out of day scope", () => {
    const onRepeatWeekdaysChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "week", weekStart: "2026-07-12" },
          repeatWeekdays: [1, 3],
        })}
        {...noopHandlers}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
      />,
    );
    expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Repeat on Friday"));
    expect(onRepeatWeekdaysChange).toHaveBeenCalledWith([1, 3, 5]);
  });
});

describe("TaskDetailFields priority", () => {
  it("shows the priority toggle unpressed for a non-priority task", () => {
    render(<TaskDetailFields task={makeTask({})} {...noopHandlers} />);
    expect(
      screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the priority toggle pressed for a priority task", () => {
    render(<TaskDetailFields task={makeTask({ priority: true })} {...noopHandlers} />);
    expect(
      screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("calls onPriorityChange with the toggled value", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ priority: false })}
        {...noopHandlers}
        onPriorityChange={onPriorityChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });

  it("toggles off when already priority", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({ priority: true })}
        {...noopHandlers}
        onPriorityChange={onPriorityChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(false);
  });
});
