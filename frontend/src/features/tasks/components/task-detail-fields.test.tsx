import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailFields } from "./task-detail-fields";

const noopHandlers = {
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
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
});
