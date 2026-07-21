import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskRepeatPicker } from "./task-repeat-picker";

describe("TaskRepeatPicker", () => {
  it("renders seven weekday toggles, reflecting which are active", () => {
    render(<TaskRepeatPicker weekdays={[1, 3, 5]} onChange={() => {}} />);
    expect(screen.getByLabelText("Repeat on Monday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Wednesday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Friday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Sunday").getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange with the day added when toggling an inactive day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onChange).toHaveBeenCalledWith([1, 3]);
  });

  it("calls onChange with the day removed when toggling an active day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[1, 3, 5]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onChange).toHaveBeenCalledWith([1, 5]);
  });

  it("calls onChange with an empty array when unchecking the last active day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[4]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Thursday"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
