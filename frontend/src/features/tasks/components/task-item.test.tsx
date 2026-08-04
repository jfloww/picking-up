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
    const { container } = render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("buy milk")).toBeTruthy();
    expect(screen.queryByLabelText(/Subtasks:/)).toBeNull();
    // The week card's container uses this exact class pairing; the
    // default branch's non-large container is "rounded-md" with no
    // "bg-muted", so this fails if size="week" falls through to default.
    expect(container.querySelector(".rounded-lg.bg-muted")).toBeTruthy();
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
    // Only the week branch's hasMeta layout puts the title on its own
    // line below the metadata row ("mt-1 block w-full"); the default
    // branch's title button never carries "mt-1".
    expect(screen.getByText("team sync").className).toContain("mt-1");
  });

  it("shows the repeat cadence label next to the checkbox when provided", () => {
    const task = makeTask({ title: "gym" });
    render(<TaskItem task={task} size="week" repeatLabel="Mo/We/Fr" {...noopHandlers} />);
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
    // week's checkbox is sized down to 13px; the default branch's
    // non-large checkbox has no explicit size override.
    expect(screen.getByLabelText("Toggle gym").className).toContain("size-[13px]");
  });

  it("calls onSelect when the title is clicked", () => {
    const task = makeTask({ title: "call dentist" });
    const onSelect = vi.fn();
    const { container } = render(
      <TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />,
    );
    fireEvent.click(screen.getByText("call dentist"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".rounded-lg.bg-muted")).toBeTruthy();
  });

  it("strikes through the title and dims the card for a done task", () => {
    const task = makeTask({ title: "done thing", done: true });
    const { container } = render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("done thing").className).toContain("line-through");
    // Card-level "opacity-55" dimming on done is unique to the week
    // branch; the default branch's non-large container never dims on
    // task.done (only "large" does, via a different class/value).
    expect(container.querySelector(".opacity-55")).toBeTruthy();
  });
});
