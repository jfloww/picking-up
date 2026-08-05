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

  it("restarts the transition from the current state when toggled again mid-animation", () => {
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
    expect(result.current.get("t")).toEqual({ done: true, animationClass: "animate-task-exit" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false, animationClass: "animate-task-enter" });

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.get("t")).toEqual({ done: false });
  });
});
