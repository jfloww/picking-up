import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Subtask } from "../types";
import {
  SUBTASK_TRANSITION_DURATION_MS,
  useSubtaskTransitionClasses,
} from "./use-subtask-transition-classes";

function makeSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return { id: "s", title: "subtask", done: false, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSubtaskTransitionClasses", () => {
  it("returns each subtask's live done state with no animation class on initial mount", () => {
    const a = makeSubtask({ id: "a", done: false });
    const b = makeSubtask({ id: "b", done: true });
    const { result } = renderHook(({ subtasks }) => useSubtaskTransitionClasses(subtasks), {
      initialProps: { subtasks: [a, b] },
    });
    expect(result.current.get("a")).toEqual({ done: false });
    expect(result.current.get("b")).toEqual({ done: true });
  });

  it("plays an enter animation for a subtask id not present on the previous render, then clears it", () => {
    const existing = makeSubtask({ id: "a" });
    const { result, rerender } = renderHook(({ subtasks }) => useSubtaskTransitionClasses(subtasks), {
      initialProps: { subtasks: [existing] },
    });
    expect(result.current.get("a")).toEqual({ done: false });

    const added = makeSubtask({ id: "b" });
    rerender({ subtasks: [existing, added] });
    expect(result.current.get("b")).toEqual({ done: false, enterAnimationClass: "animate-subtask-enter" });
    // The pre-existing subtask is untouched by the other one's arrival.
    expect(result.current.get("a")).toEqual({ done: false });

    act(() => {
      vi.advanceTimersByTime(SUBTASK_TRANSITION_DURATION_MS);
    });
    expect(result.current.get("b")).toEqual({ done: false });
  });

  it("holds the old done value with a section-exit class right after done flips, then flips to the new value with a section-enter class, then clears", () => {
    const subtask = makeSubtask({ id: "s", done: false });
    const { result, rerender } = renderHook(({ subtasks }) => useSubtaskTransitionClasses(subtasks), {
      initialProps: { subtasks: [subtask] },
    });
    expect(result.current.get("s")).toEqual({ done: false });

    rerender({ subtasks: [{ ...subtask, done: true }] });
    expect(result.current.get("s")).toEqual({
      done: false,
      sectionAnimationClass: "animate-subtask-exit",
    });

    act(() => {
      vi.advanceTimersByTime(SUBTASK_TRANSITION_DURATION_MS);
    });
    expect(result.current.get("s")).toEqual({
      done: true,
      sectionAnimationClass: "animate-subtask-enter",
    });

    act(() => {
      vi.advanceTimersByTime(SUBTASK_TRANSITION_DURATION_MS);
    });
    expect(result.current.get("s")).toEqual({ done: true });
  });

  it("does not play a section transition for a subtask that was already present with the same done value", () => {
    const subtask = makeSubtask({ id: "s", done: false });
    const { result, rerender } = renderHook(({ subtasks }) => useSubtaskTransitionClasses(subtasks), {
      initialProps: { subtasks: [subtask] },
    });

    rerender({ subtasks: [{ ...subtask, title: "renamed" }] });
    expect(result.current.get("s")).toEqual({ done: false });
  });

  it("bypasses both transitions entirely when prefers-reduced-motion is set", () => {
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

    const subtask = makeSubtask({ id: "s", done: false });
    const { result, rerender } = renderHook(({ subtasks }) => useSubtaskTransitionClasses(subtasks), {
      initialProps: { subtasks: [subtask] },
    });

    rerender({ subtasks: [{ ...subtask, done: true }, makeSubtask({ id: "new" })] });
    // No exit/enter phases at all — live values show up immediately with no
    // animation classes, for both the toggled subtask and the new one.
    expect(result.current.get("s")).toEqual({ done: true });
    expect(result.current.get("new")).toEqual({ done: false });

    matchMediaSpy.mockRestore();
  });
});
