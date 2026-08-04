import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDragToReorder } from "./use-drag-to-reorder";

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
}: {
  onReorder: (id: string, insertBeforeId: string | null) => void;
}) {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { dragState, getDragHandlers } = useDragToReorder({
    itemRefs,
    orderedIds: ["a", "b", "c"],
    onReorder,
  });

  return (
    <div>
      <div
        ref={(el) => {
          itemRefs.current["a"] = el;
        }}
        data-testid="item-a"
      >
        <button type="button" data-testid="handle-a" {...getDragHandlers("a", "Task A")} onClick={() => onReorder("clicked", null)}>
          Handle A
        </button>
      </div>
      <div
        ref={(el) => {
          itemRefs.current["b"] = el;
        }}
        data-testid="item-b"
      />
      <div
        ref={(el) => {
          itemRefs.current["c"] = el;
        }}
        data-testid="item-c"
      />
      <div data-testid="target">{dragState ? (dragState.insertBeforeId ?? "end") : "not-dragging"}</div>
    </div>
  );
}

function setup(onReorder = vi.fn()) {
  render(<Harness onReorder={onReorder} />);
  mockRect(screen.getByTestId("item-a"), { top: 0, bottom: 50, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-b"), { top: 50, bottom: 100, left: 0, right: 100 });
  mockRect(screen.getByTestId("item-c"), { top: 100, bottom: 150, left: 0, right: 100 });
  return { onReorder, handle: screen.getByTestId("handle-a") };
}

describe("useDragToReorder", () => {
  it("does not reorder on a plain click (no movement past the threshold)", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not suppress the click after a non-drag pointerdown/up", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(handle);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith("clicked", null);
  });

  it("resolves to the item whose upper half the pointer is over, and shows it while dragging", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 }); // upper half of item-b (50-100)
    expect(screen.getByTestId("target").textContent).toBe("b");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(onReorder).toHaveBeenCalledWith("a", "b");
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("resolves to the end (null) when the pointer is past every item's midpoint", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 140 }); // lower half of item-c
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 140 });
    expect(onReorder).toHaveBeenCalledWith("a", null);
  });

  it("suppresses the click that follows a real drag", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.click(handle);
    expect(onReorder).toHaveBeenCalledTimes(1); // only the reorder call
    expect(onReorder).toHaveBeenCalledWith("a", "b");
  });

  it("cancels cleanly on pointercancel without reordering", () => {
    const { onReorder, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.getByTestId("target").textContent).toBe("not-dragging");
  });

  it("does not capture the pointer on a plain click (would break nested click handlers)", () => {
    const { handle } = setup();
    const captureSpy = vi.fn();
    handle.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the pointer once a real drag starts (movement past the threshold)", () => {
    const { handle } = setup();
    const captureSpy = vi.fn();
    handle.setPointerCapture = captureSpy;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(captureSpy).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(captureSpy).toHaveBeenCalledWith(1);
  });
});
