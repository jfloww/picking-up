import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailDrawer } from "./task-detail-drawer";

const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailDrawer", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("shows the task's checkbox, title, and memo", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByText("write tests")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value,
    ).toBe("with care");
  });

  it("renders as a fixed-position overlay, not swapped inline", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByTestId("task-detail-drawer").className).toContain("fixed");
  });

  it("calls onToggle from the header checkbox", () => {
    const onToggle = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("removes its Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onDelete from the delete button", () => {
    const onDelete = vi.fn();
    render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows a time input in the header and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task time")).toHaveLength(1);
  });

  it("calls onPriorityChange from the priority toggle", () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskDetailDrawer task={task} {...noopHandlers} onPriorityChange={onPriorityChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(onPriorityChange).toHaveBeenCalledWith(true);
  });
});
