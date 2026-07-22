import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TasksProvider, tasksReducer, useTasks } from "./store";
import { fakeRepository, makeTask } from "./test-utils";
import { addDays, todayKey, weekStartOf } from "./lib/dates";

describe("tasksReducer", () => {
  it("handles loaded/added/updated/removed", () => {
    const task = makeTask({ id: "a" });
    let state = tasksReducer(
      { loaded: false, tasks: [] },
      { type: "loaded", tasks: [task] },
    );
    expect(state).toEqual({ loaded: true, tasks: [task] });

    const other = makeTask({ id: "b" });
    state = tasksReducer(state, { type: "added", task: other });
    expect(state.tasks).toHaveLength(2);

    state = tasksReducer(state, {
      type: "updated",
      task: { ...task, done: true },
    });
    expect(state.tasks[0].done).toBe(true);

    state = tasksReducer(state, { type: "removed", id: "a" });
    expect(state.tasks.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("TasksProvider", () => {
  function setup(repo = fakeRepository()) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TasksProvider repository={repo}>{children}</TasksProvider>
    );
    return { repo, ...renderHook(() => useTasks(), { wrapper }) };
  }

  it("loads tasks, applies rollover, and persists rolled tasks", async () => {
    const stale = makeTask({
      id: "stale",
      scope: { kind: "day", date: "2020-01-01" },
    });
    const { repo, result } = setup(fakeRepository([stale]));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.tasks[0].scope.kind).toBe("week");
    await waitFor(() => expect(repo.tasks[0].scope.kind).toBe("week"));
  });

  it("addTask creates a task and persists it; blank titles are ignored", async () => {
    const { repo, result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addTask("  ", { kind: "day", date: todayKey() });
      result.current.addTask("write plan", { kind: "day", date: todayKey() });
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].title).toBe("write plan");
    await waitFor(() => expect(repo.tasks).toHaveLength(1));
  });

  it("toggleTask flips done and sets/clears completedAt", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.toggleTask("a"));
    expect(result.current.tasks[0].done).toBe(true);
    expect(result.current.tasks[0].completedAt).toBeTruthy();

    act(() => result.current.toggleTask("a"));
    expect(result.current.tasks[0].done).toBe(false);
    expect(result.current.tasks[0].completedAt).toBeUndefined();
  });

  it("setMemo and removeTask update state and repository", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setMemo("a", "details"));
    expect(result.current.tasks[0].memo).toBe("details");

    act(() => result.current.removeTask("a"));
    expect(result.current.tasks).toHaveLength(0);
    await waitFor(() => expect(repo.tasks).toHaveLength(0));
  });

  describe("rollover on date change (not just mount)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-rolls tasks when the date changes while the tab stays open, on focus/visibilitychange", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const dayD = todayKey(); // "today" pinned at test start

      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: dayD },
      });
      const { repo, result } = setup(fakeRepository([task]));

      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.tasks[0].scope).toEqual({ kind: "day", date: dayD });

      const dayLater = addDays(dayD, 8);
      const [y, m, d] = dayLater.split("-").map(Number);
      act(() => {
        vi.setSystemTime(new Date(y, m - 1, d));
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() =>
        expect(result.current.tasks[0].scope).toEqual({
          kind: "week",
          weekStart: weekStartOf(dayLater),
        }),
      );
      await waitFor(() =>
        expect(repo.tasks[0].scope).toEqual({
          kind: "week",
          weekStart: weekStartOf(dayLater),
        }),
      );
    });
  });

  describe("routines", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("materializes today's occurrence for a matching anchor on load", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // Thursday, weekday 4
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
      });
      const { repo, result } = setup(fakeRepository([anchor]));

      await waitFor(() => expect(result.current.loaded).toBe(true));
      const spawned = result.current.tasks.find((t) => t.repeatSourceId === "anchor");
      expect(spawned).toMatchObject({
        title: "task",
        scope: { kind: "day", date: "2026-07-16" },
      });
      await waitFor(() =>
        expect(repo.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
    });

    it("materializes a new occurrence when the date changes while the tab stays open", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 15)); // Wednesday, weekday 3 — not matching yet
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4], // Thursday
      });
      const { repo, result } = setup(fakeRepository([anchor]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(false);

      act(() => {
        vi.setSystemTime(new Date(2026, 6, 16)); // Thursday
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() =>
        expect(result.current.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
      await waitFor(() =>
        expect(repo.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
    });

    it("setRepeatWeekdays sets, then clears to undefined when weekdays is empty", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", [1, 3, 5]));
      expect(result.current.tasks[0].repeatWeekdays).toEqual([1, 3, 5]);
      await waitFor(() => expect(repo.tasks[0].repeatWeekdays).toEqual([1, 3, 5]));

      act(() => result.current.setRepeatWeekdays("a", []));
      expect(result.current.tasks[0].repeatWeekdays).toBeUndefined();
    });
  });

  describe("time and subtask actions", () => {
    it("setTime sets, rejects invalid, and clears", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setTime("a", "09:30"));
      expect(result.current.tasks[0].time).toBe("09:30");
      await waitFor(() => expect(repo.tasks[0].time).toBe("09:30"));

      act(() => result.current.setTime("a", "25:00"));
      expect(result.current.tasks[0].time).toBe("09:30"); // invalid ignored

      act(() => result.current.setTime("a", undefined));
      expect(result.current.tasks[0].time).toBeUndefined();
    });

    it("addSubtask trims and ignores blank titles", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => {
        result.current.addSubtask("a", "   ");
        result.current.addSubtask("a", "  buy nails  ");
      });
      expect(result.current.tasks[0].subtasks).toHaveLength(1);
      expect(result.current.tasks[0].subtasks![0]).toMatchObject({
        title: "buy nails",
        done: false,
      });
      await waitFor(() => expect(repo.tasks[0].subtasks).toHaveLength(1));
    });

    it("toggleSubtask flips one subtask; removeSubtask deletes it", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        subtasks: [
          { id: "s1", title: "one", done: false },
          { id: "s2", title: "two", done: false },
        ],
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.toggleSubtask("a", "s1"));
      expect(result.current.tasks[0].subtasks).toEqual([
        { id: "s1", title: "one", done: true },
        { id: "s2", title: "two", done: false },
      ]);

      act(() => result.current.removeSubtask("a", "s2"));
      expect(result.current.tasks[0].subtasks).toEqual([
        { id: "s1", title: "one", done: true },
      ]);
      await waitFor(() => expect(repo.tasks[0].subtasks).toHaveLength(1));
    });
  });

  describe("priority action", () => {
    it("setPriority sets and clears the flag", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setPriority("a", true));
      expect(result.current.tasks[0].priority).toBe(true);
      await waitFor(() => expect(repo.tasks[0].priority).toBe(true));

      act(() => result.current.setPriority("a", false));
      expect(result.current.tasks[0].priority).toBe(false);
    });
  });
});
