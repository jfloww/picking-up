import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDueDateEditor } from "./task-due-date-editor";

const noopHandlers = {
  onDueDateChange: () => {},
};

describe("TaskDueDateEditor", () => {
  it("renders the date input with the given value", () => {
    render(<TaskDueDateEditor dueDate="2026-07-31" {...noopHandlers} />);
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-07-31");
  });

  it("calls onDueDateChange with the new value on change", () => {
    const onDueDateChange = vi.fn();
    render(<TaskDueDateEditor dueDate="2026-07-31" onDueDateChange={onDueDateChange} />);
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-01" } });
    expect(onDueDateChange).toHaveBeenCalledWith("2026-08-01");
  });

  it("shows Clear only when a due date is set, and calls onDueDateChange(undefined) from it", () => {
    const onDueDateChange = vi.fn();
    const { rerender } = render(<TaskDueDateEditor onDueDateChange={onDueDateChange} />);
    expect(screen.queryByText("Clear")).toBeNull();

    rerender(<TaskDueDateEditor dueDate="2026-07-31" onDueDateChange={onDueDateChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onDueDateChange).toHaveBeenCalledWith(undefined);
  });

  it("shows a 'Due date' label only in the drawer variant", () => {
    const { rerender } = render(<TaskDueDateEditor {...noopHandlers} />);
    expect(screen.queryByText("Due date")).toBeNull();

    rerender(<TaskDueDateEditor {...noopHandlers} variant="drawer" />);
    expect(screen.getByText("Due date")).toBeTruthy();
  });
});
