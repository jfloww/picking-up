import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { useFocusTrap, useRestoreFocusOnUnmount } from "./use-focus-trap";

function TrapHarness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button type="button">outside</button>
      <div ref={ref} data-testid="trap">
        {/* Mirrors Base UI's Checkbox: a visually-hidden native input shim
            that must never be treated as a trap boundary candidate. */}
        <input type="checkbox" tabIndex={-1} aria-hidden="true" readOnly />
        <button type="button">first</button>
        <button type="button">second</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

function RestoreHarness({ mounted }: { mounted: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <button type="button">outside</button>
      {mounted && <RestoreChild containerRef={ref} />}
    </div>
  );
}

function RestoreChild({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  useRestoreFocusOnUnmount(containerRef);
  return (
    <div ref={containerRef} data-testid="restore-container">
      <button type="button">inside</button>
    </div>
  );
}

function RestoreWithInitialFocusChild({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const preferredRef = useRef<HTMLButtonElement>(null);
  useRestoreFocusOnUnmount(containerRef, preferredRef);
  return (
    <div ref={containerRef} data-testid="restore-container">
      <button type="button">first in DOM order</button>
      <button ref={preferredRef} type="button">
        preferred target
      </button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("wraps Tab from the last focusable element to the first", () => {
    render(<TrapHarness active />);
    const buttons = Array.from(document.querySelectorAll("button"));
    const first = buttons[1]!; // buttons[0] is "outside"
    const last = buttons[3]!;
    last.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    render(<TrapHarness active />);
    const buttons = Array.from(document.querySelectorAll("button"));
    const first = buttons[1]!;
    const last = buttons[3]!;
    first.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not intercept Tab while inactive", () => {
    render(<TrapHarness active={false} />);
    const buttons = Array.from(document.querySelectorAll("button"));
    const last = buttons[3]!;
    last.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    // No wrap happened — focus is exactly where it was left, since jsdom
    // doesn't implement native Tab focus movement and nothing intercepted it.
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back inside the container if the tracked element isn't there", () => {
    render(<TrapHarness active />);
    const outside = document.querySelector("button") as HTMLButtonElement;
    const trap = document.querySelector('[data-testid="trap"]') as HTMLDivElement;
    const first = trap.querySelector("button") as HTMLButtonElement;
    outside.focus();
    fireEvent.keyDown(trap, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });
});

describe("useRestoreFocusOnUnmount", () => {
  it("moves focus into the container on mount when focus is outside it", () => {
    const { rerender } = render(<RestoreHarness mounted={false} />);
    const outside = document.querySelector("button") as HTMLButtonElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<RestoreHarness mounted />);

    const inside = document.querySelector('[data-testid="restore-container"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(inside);
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const { rerender } = render(<RestoreHarness mounted={false} />);
    const outside = document.querySelector("button") as HTMLButtonElement;
    outside.focus();

    rerender(<RestoreHarness mounted />);
    const inside = document.querySelector('[data-testid="restore-container"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(inside);

    rerender(<RestoreHarness mounted={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it("focuses the given initialFocusRef target instead of the first focusable element, when provided", () => {
    function Harness({ mounted }: { mounted: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      return <div>{mounted && <RestoreWithInitialFocusChild containerRef={ref} />}</div>;
    }
    render(<Harness mounted />);
    expect(document.activeElement?.textContent).toBe("preferred target");
  });
});
