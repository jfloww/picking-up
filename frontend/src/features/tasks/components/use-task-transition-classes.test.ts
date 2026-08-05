import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { useTaskTransitionClasses } from "./use-task-transition-classes";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskTransitionClasses", () => {
  it("returns each task's live done state with no animation class on initial mount", () => {
    const a = makeTask({ id: "a", done: false });
    const b = makeTask({ id: "b", done: true });
    const { result } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [a, b] },
    });
    expect(result.current.get("a")).toEqual({ done: false });
    expect(result.current.get("b")).toEqual({ done: true });
  });

  it("holds the old done value with an exit class right after done flips, then flips to the new value with an enter class, then clears", () => {
    const task = makeTask({ id: "t", done: false });
    const { result, rerender } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [task] },
    });
    expect(result.current.get("t")).toEqual({ done: false });

    rerender({ tasks: [{ ...task, done: true }] });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: true, animationClass: "animate-task-enter" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: true });
  });

  it("keeps animating out of the currently-rendered section when toggled again mid-animation", () => {
    const task = makeTask({ id: "t", done: false });
    const { result, rerender } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [task] },
    });

    rerender({ tasks: [{ ...task, done: true }] });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(100); // still mid-exit
    });
    rerender({ tasks: [{ ...task, done: false }] }); // toggled back before the exit finished
    // Still animating out of the section it was already exiting (oldDone
    // stays false) rather than teleporting through Done Today via the live
    // previous value (which would have been true here).
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-enter" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false });
  });

  it("bypasses the transition delay entirely when prefers-reduced-motion is set", () => {
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) as MediaQueryList,
    );

    const task = makeTask({ id: "t", done: false });
    const { result, rerender } = renderHook(({ tasks }) => useTaskTransitionClasses(tasks), {
      initialProps: { tasks: [task] },
    });
    expect(result.current.get("t")).toEqual({ done: false });

    rerender({ tasks: [{ ...task, done: true }] });
    // No exit/enter phases at all — the live value shows up immediately
    // with no animation class.
    expect(result.current.get("t")).toEqual({ done: true });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: true });

    matchMediaSpy.mockRestore();
  });
});
