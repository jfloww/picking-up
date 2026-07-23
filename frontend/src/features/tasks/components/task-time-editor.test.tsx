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

  it("shows the duration select only when a time is set", () => {
    const { rerender } = render(<TaskTimeEditor {...noopHandlers} />);
    expect(screen.queryByLabelText("Task duration")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect(screen.getByLabelText("Task duration")).toBeTruthy();
  });

  it("renders the duration presets and the given value", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    const select = screen.getByLabelText("Task duration") as HTMLSelectElement;
    expect(select.value).toBe("90");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["No duration", "15m", "30m", "45m", "1h", "1.5h", "2h"]);
  });

  it("styles every option with the popover tokens, so the native dropdown popup isn't unstyled white-on-white", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    const select = screen.getByLabelText("Task duration") as HTMLSelectElement;
    for (const option of Array.from(select.options)) {
      expect(option.className).toContain("bg-popover");
      expect(option.className).toContain("text-popover-foreground");
    }
  });

  it("defaults to no duration selected when durationMinutes is unset", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task duration") as HTMLSelectElement).value).toBe("");
  });

  it("calls onDurationChange with a number on selection, and undefined for 'No duration'", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    const select = screen.getByLabelText("Task duration");
    fireEvent.change(select, { target: { value: "60" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);

    fireEvent.change(select, { target: { value: "" } });
    expect(onDurationChange).toHaveBeenCalledWith(undefined);
  });
});
