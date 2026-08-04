import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToRescheduleOrReorder } from "./use-drag-to-reschedule-or-reorder";

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

function Harness({
  onReorder,
  onReschedule,
  onParentPointerDown,
}: {
  onReorder: (id: string, insertBeforeId: string | null, sourceDate: string) => void;
  onReschedule: (id: string, date: string) => void;
  onParentPointerDown?: () => void;
}) {
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToRescheduleOrReorder({
    columnRefs,
    itemRefs,
    orderedIdsByDate: { "2026-07-13": ["a", "b"], "2026-07-14": ["c"] },
    onReorder,
    onReschedule,
  });

  return (
    <div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-13"] = el;
        }}
        data-testid="col-mon"
      >
        <div
          ref={(el) => {
            itemRefs.current["a"] = el;
          }}
          data-testid="item-a"
          onPointerDown={onParentPointerDown}
        >
          <button type="button" data-testid="handle-a" {...getDragHandlers("a", "Task A", "2026-07-13", false)} onClick={() => onReorder("clicked", null, "2026-07-13")}>
            Handle A
          </button>
        </div>
        <div
          ref={(el) => {
            itemRefs.current["b"] = el;
          }}
          data-testid="item-b"
        />
        {/* A second draggable sharing the same hook instance (and therefore
            the same suppressClickRef) as handle-a, but never itself dragged
            in the click-suppression tests — its onClick proves the
            suppression flag doesn't leak across wrappers. */}
        <button
          type="button"
          data-testid="handle-timed"
          {...getDragHandlers("timed", "Timed Task", "2026-07-13", true)}
          onClick={() => onReorder("clicked-timed", null, "2026-07-13")}
        >
          Handle Timed
        </button>
      </div>
      <div
        ref={(el) => {
          columnRefs.current["2026-07-14"] = el;
        }}
        data-testid="col-tue"
      />
      <div data-testid="resolution">
        {dragState ? JSON.stringify(dragState.resolution) : "not-dragging"}
      </div>
    </div>
  );
}

function setup(onReorder = vi.fn(), onReschedule = vi.fn(), onParentPointerDown?: () => void) {
  render(
    <Harness
      onReorder={onReorder}
      onReschedule={onReschedule}
      onParentPointerDown={onParentPointerDown}
    />,
  );
  mockRect(screen.getByTestId("col-mon"), { top: 0, bottom: 200, left: 0, right: 100 });
  mockRect(screen.getByTestId("col-tue"), { top: 0, bottom: 200, left: 200, right: 300 });
  mockRect(screen.getByTestId("item-a"), { top: 0, bottom: 50, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-b"), { top: 50, bottom: 100, left: 0, right: 100 });
  return {
    onReorder,
    onReschedule,
    handleA: screen.getByTestId("handle-a"),
    handleTimed: screen.getByTestId("handle-timed"),
  };
}

describe("useDragToRescheduleOrReorder", () => {
  it("does nothing on a plain click (no movement past the threshold)", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    // Distinct from the test above, which only proves no *mutation* fires
    // on a plain click: this proves the click itself still reaches its own
    // handler, i.e. the drag machinery didn't swallow a real click.
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(handleA);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith("clicked", null, "2026-07-13");
  });

  it("self-expires the click-suppression flag even if no click ever reaches onClickCapture (cross-day drop unmount)", () => {
    vi.useFakeTimers();
    try {
      const { onReorder, onReschedule, handleA, handleTimed } = setup();
      fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 250, clientY: 50 });
      fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 250, clientY: 50 });
      expect(onReschedule).toHaveBeenCalledWith("a", "2026-07-14");
      // No click on handle-a at all — a real cross-day drop unmounts it from
      // its old column, so only the setTimeout safety net can clear the flag.
      vi.advanceTimersByTime(1);

      fireEvent.click(handleTimed);
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith("clicked-timed", null, "2026-07-13");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not capture the pointer on a plain click (would break nested click handlers)", () => {
    const { handleA } = setup();
    const captureSpy = vi.fn();
    handleA.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the pointer once a real drag starts (movement past the threshold)", () => {
    const { handleA } = setup();
    const captureSpy = vi.fn();
    handleA.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(captureSpy).toHaveBeenCalledWith(1);
  });

  it("resolves same-day untimed drop to a reorder, targeting the item whose upper half the pointer is over", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 }); // upper half of item-b (50-100)
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reorder", insertBeforeId: "b" }),
    );
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).toHaveBeenCalledWith("a", "b", "2026-07-13");
  });

  it("resolves same-day untimed drop past every item to insertBeforeId null", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 150 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 150 });
    expect(onReorder).toHaveBeenCalledWith("a", null, "2026-07-13");
  });

  it("is a no-op with no indicator when a timed task is dropped within its own day", () => {
    const { onReorder, onReschedule, handleTimed } = setup();
    fireEvent.pointerDown(handleTimed, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleTimed, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reorder-noop" }),
    );
    fireEvent.pointerUp(handleTimed, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("resolves a drop on a different day's column to a reschedule, regardless of timed/untimed", () => {
    const { onReschedule, handleTimed } = setup();
    fireEvent.pointerDown(handleTimed, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleTimed, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(screen.getByTestId("resolution").textContent).toBe(
      JSON.stringify({ kind: "reschedule", date: "2026-07-14" }),
    );
    fireEvent.pointerUp(handleTimed, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(onReschedule).toHaveBeenCalledWith("timed", "2026-07-14");
  });

  it("is a no-op when dropped outside every column", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(screen.getByTestId("resolution").textContent).toBe(JSON.stringify({ kind: "outside" }));
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReorder, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.click(handleA);
    expect(onReorder).toHaveBeenCalledTimes(1); // only the reorder call
    expect(onReorder).toHaveBeenCalledWith("a", "b", "2026-07-13");
  });

  it("cancels cleanly on pointercancel without dispatching either outcome", () => {
    const { onReorder, onReschedule, handleA } = setup();
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerCancel(handleA, { pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("resolution").textContent).toBe("not-dragging");
  });

  it("stops the pointerdown event from propagating to the card", () => {
    const parentPointerDown = vi.fn();
    const { handleA } = setup(vi.fn(), vi.fn(), parentPointerDown);
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(parentPointerDown).not.toHaveBeenCalled();
  });
});
