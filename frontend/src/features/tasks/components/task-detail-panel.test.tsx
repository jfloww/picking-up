import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailPanel } from "./task-detail-panel";

const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailPanel", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("shows the task's checkbox, title, and memo", () => {
    render(<TaskDetailPanel task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByText("write tests")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value,
    ).toBe("with care");
  });

  it("calls onToggle from the header checkbox", () => {
    const onToggle = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onDelete from the delete button", () => {
    const onDelete = vi.fn();
    render(<TaskDetailPanel task={task} {...noopHandlers} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows a time input in the header (alongside the checkbox and close button) and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailPanel task={timedTask} {...noopHandlers} />);
    const header = within(screen.getByTestId("task-detail-header"));
    expect(header.getByRole("checkbox")).toBeTruthy();
    expect(header.getByLabelText("Close details")).toBeTruthy();
    expect(header.getByLabelText("Task time")).toBeTruthy();
    expect(header.getAllByText("Clear")).toHaveLength(1);
    expect(screen.getAllByText("Clear")).toHaveLength(1);
  });

  it("calls onTimeChange from the header time input", () => {
    const onTimeChange = vi.fn();
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailPanel task={timedTask} {...noopHandlers} onTimeChange={onTimeChange} />);
    const header = within(screen.getByTestId("task-detail-header"));
    fireEvent.change(header.getByLabelText("Task time"), { target: { value: "15:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
  });
});
