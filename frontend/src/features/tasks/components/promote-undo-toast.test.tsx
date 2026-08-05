import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromoteUndoToast } from "./promote-undo-toast";

describe("PromoteUndoToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the moved task's title", () => {
    render(<PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/buy milk/)).toBeTruthy();
  });

  it("calls onUndo when Undo is clicked", () => {
    const onUndo = vi.fn();
    render(<PromoteUndoToast title="buy milk" onUndo={onUndo} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss automatically after 6 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clears the timer on unmount (no dismiss call after unmount)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <PromoteUndoToast title="buy milk" onUndo={() => {}} onDismiss={onDismiss} />,
    );
    unmount();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
