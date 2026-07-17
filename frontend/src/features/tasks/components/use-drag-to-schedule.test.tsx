import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToSchedule } from "./use-drag-to-schedule";

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

function Harness({ onSchedule }: { onSchedule: (id: string, time?: string) => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    hourHeight: 48,
    onSchedule,
  });

  return (
    <div>
      <div ref={allDayZoneRef} data-testid="all-day">
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A")}>
          <button type="button" onClick={() => onSchedule("clicked-title", undefined)}>
            Task A
          </button>
        </div>
      </div>
      <div ref={railRef} data-testid="rail" />
      <div data-testid="preview">{dragState ? (dragState.previewTime ?? "clear") : "none"}</div>
    </div>
  );
}

function setup(onSchedule = vi.fn()) {
  render(<Harness onSchedule={onSchedule} />);
  const rail = screen.getByTestId("rail");
  const allDay = screen.getByTestId("all-day");
  // Generously tall rail rect + scrollTop 0 so clientY maps directly to
  // content-relative y with no scroll arithmetic (see Global Constraints).
  mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
  Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
  mockRect(allDay, { top: 0, bottom: 90, left: 0, right: 300 });
  return { onSchedule, chip: screen.getByTestId("chip-a") };
}

describe("useDragToSchedule", () => {
  it("does not schedule on a plain click (no movement past the threshold)", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule).toHaveBeenCalledWith("clicked-title", undefined);
  });

  it("schedules a snapped time when dropped on the rail, and shows a preview while dragging", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 }); // rail-relative y=456 -> 09:30
    expect(screen.getByTestId("preview").textContent).toBe("09:30");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(onSchedule).toHaveBeenCalledWith("a", "09:30");
    expect(screen.getByTestId("preview").textContent).toBe("none");
  });

  it("clears the time when dropped on the all-day zone", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    expect(screen.getByTestId("preview").textContent).toBe("clear");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    expect(onSchedule).toHaveBeenCalledWith("a", undefined);
  });

  it("is a no-op when dropped outside both zones", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 2000 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 2000 });
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onSchedule).toHaveBeenCalledTimes(1); // only the schedule call
    expect(onSchedule).toHaveBeenCalledWith("a", "09:30");
  });

  it("cancels cleanly on pointercancel without scheduling", () => {
    const { onSchedule, chip } = setup();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    fireEvent.pointerCancel(chip, { pointerId: 1 });
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview").textContent).toBe("none");
  });
});
