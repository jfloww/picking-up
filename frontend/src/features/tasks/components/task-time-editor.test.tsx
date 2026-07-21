import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskTimeEditor } from "./task-time-editor";

describe("TaskTimeEditor", () => {
  it("renders the time input with the given value", () => {
    render(<TaskTimeEditor time="14:00" onTimeChange={() => {}} />);
    expect((screen.getByLabelText("Task time") as HTMLInputElement).value).toBe("14:00");
  });

  it("calls onTimeChange with the new value on change", () => {
    const onTimeChange = vi.fn();
    render(<TaskTimeEditor time="14:00" onTimeChange={onTimeChange} />);
    fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
  });

  it("shows Clear only when a time is set, and calls onTimeChange(undefined) from it", () => {
    const onTimeChange = vi.fn();
    const { rerender } = render(<TaskTimeEditor onTimeChange={onTimeChange} />);
    expect(screen.queryByText("Clear")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" onTimeChange={onTimeChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onTimeChange).toHaveBeenCalledWith(undefined);
  });
});
