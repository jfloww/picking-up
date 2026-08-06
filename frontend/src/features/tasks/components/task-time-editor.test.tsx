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

  it("shows the end-time input only when a time is set", () => {
    const { rerender } = render(<TaskTimeEditor {...noopHandlers} />);
    expect(screen.queryByLabelText("Task end time")).toBeNull();

    rerender(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect(screen.getByLabelText("Task end time")).toBeTruthy();
  });

  it("is a time input, not a number", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).type).toBe("time");
  });

  it("derives End from Start + durationMinutes", () => {
    render(<TaskTimeEditor time="14:00" durationMinutes={90} {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).value).toBe("15:30");
  });

  it("defaults to an empty End when durationMinutes is unset", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).value).toBe("");
  });

  it("calls onDurationChange with the minutes between Start and a valid new End", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "15:00" } });
    expect(onDurationChange).toHaveBeenCalledWith(60);
  });

  it("rejects an End at or before Start — does not call onDurationChange", () => {
    const onDurationChange = vi.fn();
    render(
      <TaskTimeEditor
        time="14:00"
        durationMinutes={30}
        {...noopHandlers}
        onDurationChange={onDurationChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "13:30" } }); // before Start
    fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "14:00" } }); // equal to Start
    expect(onDurationChange).not.toHaveBeenCalled();
  });

  it("has a min attribute on End matching Start, as a native-picker hint", () => {
    render(<TaskTimeEditor time="14:00" {...noopHandlers} />);
    expect((screen.getByLabelText("Task end time") as HTMLInputElement).min).toBe("14:00");
  });

  describe("editing Start", () => {
    it("keeps End's clock time fixed, recomputing duration", () => {
      const onDurationChange = vi.fn();
      render(
        <TaskTimeEditor
          time="14:00"
          durationMinutes={60} // End = 15:00
          {...noopHandlers}
          onDurationChange={onDurationChange}
        />,
      );
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "14:30" } });
      expect(onDurationChange).toHaveBeenCalledWith(30); // 14:30 -> 15:00
    });

    it("clears the duration if the new Start would be at or after the existing End", () => {
      const onDurationChange = vi.fn();
      render(
        <TaskTimeEditor
          time="14:00"
          durationMinutes={60} // End = 15:00
          {...noopHandlers}
          onDurationChange={onDurationChange}
        />,
      );
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:00" } });
      expect(onDurationChange).toHaveBeenCalledWith(undefined);
    });

    it("does not touch duration when no duration was set yet", () => {
      const onDurationChange = vi.fn();
      render(<TaskTimeEditor time="14:00" {...noopHandlers} onDurationChange={onDurationChange} />);
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "15:00" } });
      expect(onDurationChange).not.toHaveBeenCalled();
    });
  });

  describe("drawer variant", () => {
    it("lays out Start narrower than End, roughly 38/62, not an even 50/50 split", () => {
      render(<TaskTimeEditor time="14:00" {...noopHandlers} variant="drawer" />);
      const grid = screen.getByLabelText("Task time").closest("div.grid");
      expect(grid!.className).toContain("grid-cols-[minmax(0,3fr)_minmax(0,5fr)]");
    });

    it("has no separate 'Clear' text button — clearing lives inside the End field", () => {
      render(<TaskTimeEditor time="14:00" {...noopHandlers} variant="drawer" />);
      expect(screen.queryByText("Clear")).toBeNull();
      expect(screen.getByLabelText("Clear duration")).toBeTruthy();
    });

    it("Clear duration clears the whole scheduled time, same as the old Clear button", () => {
      const onTimeChange = vi.fn();
      render(
        <TaskTimeEditor time="14:00" {...noopHandlers} onTimeChange={onTimeChange} variant="drawer" />,
      );
      fireEvent.click(screen.getByLabelText("Clear duration"));
      expect(onTimeChange).toHaveBeenCalledWith(undefined);
    });

    it("hides the End field and its clear control when no time is set", () => {
      render(<TaskTimeEditor {...noopHandlers} variant="drawer" />);
      expect(screen.queryByLabelText("Task end time")).toBeNull();
      expect(screen.queryByLabelText("Clear duration")).toBeNull();
    });
  });
});
