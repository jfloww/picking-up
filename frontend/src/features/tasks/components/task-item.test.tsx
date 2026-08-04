import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskItem } from "./task-item";
import { makeTask } from "../test-utils";

const noopHandlers = {
  onToggle: () => {},
  onMemoChange: () => {},
  onTimeChange: () => {},
  onRepeatWeekdaysChange: () => {},
  onDetachFromRoutine: () => {},
  onPriorityChange: () => {},
  onDurationChange: () => {},
  onBackgroundChange: () => {},
  onDueDateChange: () => {},
  onDelete: () => {},
  onAddSubtask: () => {},
  onToggleSubtask: () => {},
  onRemoveSubtask: () => {},
  onEditSubtaskTitle: () => {},
};

describe('TaskItem size="week"', () => {
  it("collapses to a single line when the task has no time, subtasks, or repeat", () => {
    const task = makeTask({ title: "buy milk" });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("buy milk")).toBeTruthy();
    expect(screen.queryByLabelText(/Subtasks:/)).toBeNull();
  });

  it("shows a metadata line with time and subtask count when present", () => {
    const task = makeTask({
      title: "team sync",
      time: "09:00",
      subtasks: [{ id: "s1", title: "agenda", done: false }],
    });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("team sync")).toBeTruthy();
    expect(screen.getByText("9:00 AM")).toBeTruthy();
    expect(screen.getByLabelText("Subtasks: 0/1")).toBeTruthy();
  });

  it("shows the repeat cadence label next to the checkbox when provided", () => {
    const task = makeTask({ title: "gym" });
    render(<TaskItem task={task} size="week" repeatLabel="Mo/We/Fr" {...noopHandlers} />);
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
  });

  it("calls onSelect when the title is clicked", () => {
    const task = makeTask({ title: "call dentist" });
    const onSelect = vi.fn();
    render(<TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />);
    fireEvent.click(screen.getByText("call dentist"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("strikes through the title and dims the card for a done task", () => {
    const task = makeTask({ title: "done thing", done: true });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("done thing").className).toContain("line-through");
  });
});
