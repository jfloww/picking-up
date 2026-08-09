import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Subtask } from "../types";
import { SubtaskList } from "./subtask-list";

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

const subtasks: Subtask[] = [
  { id: "s1", title: "one", done: false },
  { id: "s2", title: "two", done: false },
  { id: "s3", title: "three", done: false },
];

describe("SubtaskList (drawer variant) reordering", () => {
  it("renders a reorder handle for each subtask when onReorder is provided", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    expect(screen.getByLabelText("Reorder one")).toBeTruthy();
    expect(screen.getByLabelText("Reorder two")).toBeTruthy();
    expect(screen.getByLabelText("Reorder three")).toBeTruthy();
  });

  it("does not render a reorder handle when onReorder is omitted", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        drawer
      />,
    );
    expect(screen.queryByLabelText("Reorder one")).toBeNull();
  });

  it("does not render a reorder handle for a completed subtask", () => {
    render(
      <SubtaskList
        subtasks={[
          { id: "s1", title: "one", done: true },
          { id: "s2", title: "two", done: false },
        ]}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    expect(screen.queryByLabelText("Reorder one")).toBeNull();
    expect(screen.getByLabelText("Reorder two")).toBeTruthy();
  });

  it("dragging a handle past a sibling calls onReorder with the subtask id and the sibling to insert before", () => {
    const onReorder = vi.fn();
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={onReorder}
        drawer
      />,
    );
    // The container's own rect must be mocked too — useDragToReorder
    // checks the pointer against it to decide "inside vs. outside the
    // list" (see use-drag-to-reorder.ts's resolve()), and JSDOM's default
    // zero-sized rect for an unmocked element would make every drag below
    // clientY=0 register as "outside," so onReorder would never fire and
    // this test would fail for the wrong reason.
    mockRect(screen.getByTestId("drawer-subtask-list"), {
      top: 0,
      bottom: 120,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle one").closest("li")!, {
      top: 0,
      bottom: 40,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle two").closest("li")!, {
      top: 40,
      bottom: 80,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle three").closest("li")!, {
      top: 80,
      bottom: 120,
      left: 0,
      right: 200,
    });

    const handle = screen.getByLabelText("Reorder one");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 90 }); // upper half of "three" (80-120)
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 90 });

    expect(onReorder).toHaveBeenCalledWith("s1", "s3");
  });

  it("shows a trailing drop indicator when a drag resolves past the last active subtask", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    mockRect(screen.getByTestId("drawer-subtask-list"), {
      top: 0,
      bottom: 120,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle one").closest("li")!, {
      top: 0,
      bottom: 40,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle two").closest("li")!, {
      top: 40,
      bottom: 80,
      left: 0,
      right: 200,
    });
    mockRect(screen.getByLabelText("Toggle three").closest("li")!, {
      top: 80,
      bottom: 120,
      left: 0,
      right: 200,
    });

    expect(screen.queryByTestId("reorder-indicator-end")).toBeNull();

    const handle = screen.getByLabelText("Reorder one");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    // Below every row's midpoint (the last row spans 80-120, midpoint 100)
    // but still inside the container (bottom 120) — useDragToReorder's
    // resolve() falls through its loop and returns insertBeforeId: null,
    // meaning "past every active row, at the end of the list."
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 115 });

    expect(screen.getByTestId("reorder-indicator-end")).toBeTruthy();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 115 });
  });

  it("does not show the trailing drop indicator when there is no active drag", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        drawer
      />,
    );
    expect(screen.queryByTestId("reorder-indicator-end")).toBeNull();
  });

  it("never renders a reorder handle in the plain (non-drawer) variant", () => {
    render(
      <SubtaskList
        subtasks={subtasks}
        onAdd={() => {}}
        onToggle={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Reorder one")).toBeNull();
  });
});
