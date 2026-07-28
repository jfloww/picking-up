import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToRescheduleDay } from "./use-drag-to-reschedule-day";

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
    ...rect,
  } as DOMRect);
}

function Harness({ onReschedule }: { onReschedule: (id: string, date: string) => void }) {
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleDay({ columnRefs, onReschedule });

  return (
    <div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-13"] = el;
        }}
        data-testid="col-mon"
      >
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A")}>
          <button type="button" onClick={() => onReschedule("clicked-title", "irrelevant")}>
            Task A
          </button>
        </div>
      </div>
      {/* A second, unrelated draggable item that shares the same hook instance
          (and therefore the same suppressClickRef) as chip-a, but is never
          itself dragged in these tests — proves the suppression flag doesn't
          leak across wrappers. */}
      <div data-testid="chip-b" {...getDragHandlers("b", "Task B")}>
        <button type="button" onClick={() => onReschedule("clicked-title-b", "irrelevant")}>
          Task B
        </button>
      </div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-14"] = el;
        }}
        data-testid="col-tue"
      />
      <div data-testid="target">
        {dragState ? (dragState.targetDate ?? "none-over-a-column") : "not-dragging"}
      </div>
    </div>
  );
}

function setup(onReschedule = vi.fn()) {
  render(<Harness onReschedule={onReschedule} />);
  const colMon = screen.getByTestId("col-mon");
  const colTue = screen.getByTestId("col-tue");
  mockRect(colMon, { top: 0, bottom: 100, left: 0, right: 100 });
  mockRect(colTue, { top: 0, bottom: 100, left: 200, right: 300 });
  return { onReschedule, chip: screen.getByTestId("chip-a") };
}

describe("useDragToRescheduleDay", () => {
  it("does not reschedule on a plain click (no movement past the threshold)", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onReschedule).toHaveBeenCalledTimes(1);
    expect(onReschedule).toHaveBeenCalledWith("clicked-title", "irrelevant");
  });

  it("reschedules to the column dropped on, and shows that column's date while dragging", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 }); // over col-tue
    expect(screen.getByTestId("target").textContent).toBe("2026-07-14");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("is a no-op when dropped outside every column", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onReschedule).toHaveBeenCalledTimes(1); // only the reschedule call
    expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");
  });

  it("self-expires the click-suppression flag even if no click ever reaches onClickCapture (cross-column drop unmount)", () => {
    vi.useFakeTimers();
    try {
      const { onReschedule, chip } = setup();
      fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
      fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
      expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");

      vi.advanceTimersByTime(1);

      fireEvent.click(screen.getByRole("button", { name: "Task B" }));
      expect(onReschedule).toHaveBeenCalledWith("clicked-title-b", "irrelevant");
      expect(onReschedule).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not capture the pointer on a plain click (would break nested click handlers)", () => {
    const { chip } = setup();
    const captureSpy = vi.fn();
    chip.setPointerCapture = captureSpy;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the pointer once a real drag starts (movement past the threshold)", () => {
    const { chip } = setup();
    const captureSpy = vi.fn();
    chip.setPointerCapture = captureSpy;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(captureSpy).toHaveBeenCalledWith(1);
  });

  it("cancels cleanly on pointercancel without rescheduling", () => {
    const { onReschedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerCancel(chip, { pointerId: 1 });
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });
});
