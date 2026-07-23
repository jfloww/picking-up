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

  it("shows the duration input only when a time is set", () => {
    const { rerender } = render(<TaskTimeEditor {...noopHandlers} />);
    expect(screen.queryByLabelText("Task duration")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect(screen.getByLabelText("Task duration")).toBeTruthy();
  });

  it("is a number input that offers the duration presets as suggestions, not a hard cap", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    const input = screen.getByLabelText("Task duration") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("90");

    const datalist = document.getElementById(input.list!.id) as HTMLDataListElement;
    const labels = Array.from(datalist.options).map((o) => o.textContent);
    expect(labels).toEqual(["15m", "30m", "45m", "1h", "1.5h", "2h"]);
  });

  it("defaults to an empty duration when durationMinutes is unset", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task duration") as HTMLInputElement).value).toBe("");
  });

  it("calls onDurationChange with a typed number, including values well past the presets", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    const input = screen.getByLabelText("Task duration");
    fireEvent.change(input, { target: { value: "60" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);

    fireEvent.change(input, { target: { value: "300" } }); // 5h, past every preset
    expect(onDurationChange).toHaveBeenCalledWith(300);

    fireEvent.change(input, { target: { value: "" } });
    expect(onDurationChange).toHaveBeenCalledWith(undefined);
  });

  it("gives each instance its own datalist id, so two open editors never collide", () => {
    render(
      <>
        <TaskTimeEditor time="09:00" {...noopHandlers} />
        <TaskTimeEditor time="10:00" {...noopHandlers} />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Task duration") as HTMLInputElement[];
    expect(first.list!.id).not.toBe(second.list!.id);
  });
});
