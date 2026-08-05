import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { NestBlockReason } from "../lib/nesting";
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

function Harness({
  onSchedule = () => {},
  onNest = () => {},
  onNestBlocked = () => {},
  chipANestBlockReason,
}: {
  onSchedule?: (id: string, time?: string) => void;
  onNest?: (sourceId: string, targetId: string) => void;
  onNestBlocked?: (reason: NestBlockReason) => void;
  chipANestBlockReason?: NestBlockReason;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const allDayZoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const { dragState, getDragHandlers } = useDragToSchedule({
    railRef,
    allDayZoneRef,
    cardRefs,
    hourHeight: 48,
    onSchedule,
    onNest,
    onNestBlocked,
  });

  return (
    <div>
      <div ref={allDayZoneRef} data-testid="all-day">
        <div data-testid="chip-a" {...getDragHandlers("a", "Task A", chipANestBlockReason)}>
          <button type="button" onClick={() => onSchedule("clicked-title", undefined)}>
            Task A
          </button>
        </div>
        <div data-testid="chip-target" ref={(el) => { cardRefs.current["target"] = el; }}>
          Target Task
        </div>
      </div>
      {/* A second, unrelated draggable item that shares the same hook instance
          (and therefore the same suppressClickRef) as chip-a, but is never
          itself dragged in these tests — used to prove the suppression flag
          doesn't leak across wrappers. */}
      <div data-testid="chip-b" {...getDragHandlers("b", "Task B", undefined)}>
        <button type="button" onClick={() => onSchedule("clicked-title-b", undefined)}>
          Task B
        </button>
      </div>
      <div ref={railRef} data-testid="rail" />
      <div data-testid="preview">{dragState ? (dragState.previewTime ?? "clear") : "none"}</div>
      <div data-testid="nest-target">{dragState?.nestTargetId ?? "none"}</div>
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

  it("self-expires the click-suppression flag even if no click ever reaches onClickCapture (cross-zone drop unmount)", () => {
    vi.useFakeTimers();
    try {
      const { onSchedule, chip } = setup();
      fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
      fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 556 });
      expect(onSchedule).toHaveBeenCalledWith("a", "09:30");

      // Simulate a cross-zone drop where the source wrapper (chip-a) unmounts
      // before the browser's post-pointerup click ever reaches its
      // onClickCapture — no click is fired on chip-a at all. Without the
      // safety-net timeout, suppressClickRef would stay stuck true forever.
      vi.advanceTimersByTime(1);

      // A click on a completely different, still-mounted wrapper (chip-b)
      // that shares the same suppressClickRef must NOT be suppressed.
      fireEvent.click(screen.getByRole("button", { name: "Task B" }));
      expect(onSchedule).toHaveBeenCalledWith("clicked-title-b", undefined);
      expect(onSchedule).toHaveBeenCalledTimes(2); // the drag schedule + this click
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not capture the pointer on a plain click (would break nested click handlers like a checkbox's)", () => {
    const { chip } = setup();
    const captureSpy = vi.fn();
    // jsdom doesn't implement setPointerCapture at all, so exercising the
    // real bug (capture retargeting a click's event.target away from a
    // nested descendant) isn't possible here — this stubs the API just to
    // assert *when* the hook calls it, which is the actual root cause: an
    // unconditional call on pointerdown captures on every click, not just
    // drags, and real browsers redirect the resulting click's target to
    // the capturing element, so it never reaches a nested checkbox/button.
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
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(captureSpy).toHaveBeenCalledWith(1);
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

describe("useDragToSchedule nesting", () => {
  function setupNest(nestBlockReason?: NestBlockReason) {
    const onSchedule = vi.fn();
    const onNest = vi.fn();
    const onNestBlocked = vi.fn();
    render(
      <Harness
        onSchedule={onSchedule}
        onNest={onNest}
        onNestBlocked={onNestBlocked}
        chipANestBlockReason={nestBlockReason}
      />,
    );
    const rail = screen.getByTestId("rail");
    const allDay = screen.getByTestId("all-day");
    const target = screen.getByTestId("chip-target");
    mockRect(rail, { top: 2000, bottom: 3000, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(allDay, { top: 0, bottom: 200, left: 0, right: 300 });
    mockRect(target, { top: 100, bottom: 150, left: 0, right: 300 });
    return { onSchedule, onNest, onNestBlocked, chip: screen.getByTestId("chip-a") };
  }

  it("resolves to nest and highlights the hovered card when the dragged task is eligible", () => {
    const { onNest, onSchedule, chip } = setupNest();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(screen.getByTestId("nest-target").textContent).toBe("target");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNest).toHaveBeenCalledWith("a", "target");
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("resolves to nest-blocked instead of nesting when the dragged task already has subtasks", () => {
    const { onNest, onNestBlocked, chip } = setupNest("has-subtasks");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNestBlocked).toHaveBeenCalledWith("has-subtasks");
    expect(onNest).not.toHaveBeenCalled();
  });

  it("resolves to nest-blocked for a repeating task", () => {
    const { onNestBlocked, chip } = setupNest("repeating");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 120 });
    expect(onNestBlocked).toHaveBeenCalledWith("repeating");
  });

  it("falls through to clearing the time when dropped in the all-day zone but not on a card", () => {
    const { onSchedule, onNest, chip } = setupNest();
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 190 }); // inside all-day, outside target's 100-150 rect
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 190 });
    expect(onSchedule).toHaveBeenCalledWith("a", undefined);
    expect(onNest).not.toHaveBeenCalled();
  });

  it("excludes the dragged task's own card from nest hit-testing (self-drop falls through)", () => {
    const onNest = vi.fn();
    const onSchedule = vi.fn();

    function SelfDropHarness() {
      const railRef = useRef<HTMLDivElement>(null);
      const allDayZoneRef = useRef<HTMLDivElement>(null);
      const cardRefs = useRef<Record<string, HTMLElement | null>>({});
      const { getDragHandlers } = useDragToSchedule({
        railRef,
        allDayZoneRef,
        cardRefs,
        hourHeight: 48,
        onSchedule,
        onNest,
        onNestBlocked: () => {},
      });
      return (
        <div>
          <div ref={allDayZoneRef} data-testid="all-day">
            <div
              data-testid="chip-self"
              ref={(el) => {
                cardRefs.current["self"] = el;
              }}
              {...getDragHandlers("self", "Self Task", undefined)}
            />
          </div>
          <div ref={railRef} data-testid="rail" />
        </div>
      );
    }

    render(<SelfDropHarness />);
    const allDay = screen.getByTestId("all-day");
    const chip = screen.getByTestId("chip-self");
    mockRect(allDay, { top: 0, bottom: 200, left: 0, right: 300 });
    mockRect(chip, { top: 50, bottom: 100, left: 0, right: 300 });

    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 75 }); // inside its own rect
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 75 });

    expect(onNest).not.toHaveBeenCalled();
    expect(onSchedule).toHaveBeenCalledWith("self", undefined); // falls through to all-day-zone
  });

  it("does not nest-resolve a card scrolled outside the all-day zone's bounds, even if the pointer geometrically overlaps its rect", () => {
    const { onNest, onSchedule, chip } = setupNest();
    const target = screen.getByTestId("chip-target");
    // Reposition the target below the all-day zone's own bottom (200) -
    // simulating a card scrolled out of the agenda's visible/scrollable
    // area, which (per jsdom, and real browsers) still has a real
    // bounding rect even though the pointer can't actually reach it there.
    mockRect(target, { top: 250, bottom: 300, left: 0, right: 300 });
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 10 });
    // Overlaps target's (now out-of-zone) rect geometrically, but the
    // pointer itself is outside the all-day zone (bottom: 200) and outside
    // the rail (top: 2000) too -> should resolve to "outside", not nest.
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 275 });
    expect(screen.getByTestId("nest-target").textContent).toBe("none");
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 275 });
    expect(onNest).not.toHaveBeenCalled();
    expect(onSchedule).not.toHaveBeenCalled();
  });
});
