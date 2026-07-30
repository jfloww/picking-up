import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TasksProvider, tasksReducer, useTasks } from "./store";
import { fakeRepository, makeTask } from "./test-utils";
import { addDays, todayKey, weekStartOf } from "./lib/dates";
import type { Task } from "./types";

describe("tasksReducer", () => {
  it("handles loaded/added/updated/removed", () => {
    const task = makeTask({ id: "a" });
    let state = tasksReducer(
      { loaded: false, tasks: [], syncError: null },
      { type: "loaded", tasks: [task] },
    );
    expect(state).toEqual({ loaded: true, tasks: [task], syncError: null });

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

  it("addTask returns the created task, or undefined for a blank title", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let created: Task | undefined;
    let blank: Task | undefined;
    act(() => {
      created = result.current.addTask("write plan", { kind: "day", date: todayKey() });
      blank = result.current.addTask("   ", { kind: "day", date: todayKey() });
    });

    expect(created?.title).toBe("write plan");
    expect(result.current.tasks.some((t) => t.id === created?.id)).toBe(true);
    expect(blank).toBeUndefined();
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

    it("detachFromRoutine clears repeatSourceId, leaving repeatWeekdays unset by default", async () => {
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: todayKey() },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ"));
      expect(result.current.tasks[0].repeatSourceId).toBeUndefined();
      expect(result.current.tasks[0].repeatWeekdays).toBeUndefined();
      await waitFor(() => expect(repo.tasks[0].repeatSourceId).toBeUndefined());
    });

    it("detachFromRoutine sets repeatWeekdays when weekdays are provided", async () => {
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: todayKey() },
        repeatSourceId: "anchor",
      });
      const { result } = setup(fakeRepository([occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ", [2, 4]));
      expect(result.current.tasks[0].repeatSourceId).toBeUndefined();
      expect(result.current.tasks[0].repeatWeekdays).toEqual([2, 4]);
    });

    it("detachFromRoutine records the occurrence's date in the anchor's excludedDates", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ"));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]);
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );
    });

    it("detachFromRoutine appends to existing excludedDates rather than replacing them", async () => {
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
        excludedDates: ["2026-07-09"],
      });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("occ"));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([
        "2026-07-09",
        "2026-07-16",
      ]);
    });

    it("detaching a task that was already standalone (no repeatSourceId) does not touch any anchor", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const standalone = makeTask({ id: "solo", scope: { kind: "day", date: "2026-07-16" } });
      const { result } = setup(fakeRepository([anchor, standalone]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.detachFromRoutine("solo"));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toBeUndefined();
    });

    it("detaching today's occurrence, then reloading from the repository, does not respawn a duplicate", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // Thursday, weekday 4
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const { repo, result } = setup(fakeRepository([anchor]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const spawned = result.current.tasks.find((t) => t.repeatSourceId === "anchor");
      expect(spawned).toBeTruthy();

      act(() => result.current.detachFromRoutine(spawned!.id));
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );

      const { result: reloaded } = setup(repo);
      await waitFor(() => expect(reloaded.current.loaded).toBe(true));
      const duplicates = reloaded.current.tasks.filter(
        (t) =>
          t.repeatSourceId === "anchor" &&
          t.scope.kind === "day" &&
          t.scope.date === "2026-07-16",
      );
      expect(duplicates).toHaveLength(0);
    });

    it("removeTask records the occurrence's date in the anchor's excludedDates", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.removeTask("occ"));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]);
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );
    });

    it("removing a task that was already standalone (no repeatSourceId) does not touch any anchor", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const standalone = makeTask({ id: "solo", scope: { kind: "day", date: "2026-07-16" } });
      const { result } = setup(fakeRepository([anchor, standalone]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.removeTask("solo"));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toBeUndefined();
    });

    it("deleting today's occurrence, then reloading from the repository, does not resurrect it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // Thursday, weekday 4
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const { repo, result } = setup(fakeRepository([anchor]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const spawned = result.current.tasks.find((t) => t.repeatSourceId === "anchor");
      expect(spawned).toBeTruthy();

      act(() => result.current.removeTask(spawned!.id));
      await waitFor(() => expect(repo.tasks.some((t) => t.id === spawned!.id)).toBe(false));
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );

      const { result: reloaded } = setup(repo);
      await waitFor(() => expect(reloaded.current.loaded).toBe(true));
      const resurrected = reloaded.current.tasks.filter(
        (t) =>
          t.repeatSourceId === "anchor" &&
          t.scope.kind === "day" &&
          t.scope.date === "2026-07-16",
      );
      expect(resurrected).toHaveLength(0);
    });

    it("rescheduleTaskToDay moves a plain task's scope date", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const task = makeTask({ id: "a", scope: { kind: "day", date: today } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", target));

      expect(result.current.tasks[0].scope).toEqual({ kind: "day", date: target });
      await waitFor(() => expect(repo.tasks[0].scope).toEqual({ kind: "day", date: target }));
    });

    it("rescheduleTaskToDay is a no-op when the target date matches the current date", async () => {
      const today = todayKey();
      const task = makeTask({ id: "a", scope: { kind: "day", date: today } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", today));

      expect(result.current.tasks[0]).toBe(task);
      expect(repo.tasks[0]).toBe(task);
    });

    it("rescheduleTaskToDay detaches a repeat instance and excludes its original date on the anchor", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
      });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: today },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("occ", target));

      const moved = result.current.tasks.find((t) => t.id === "occ");
      expect(moved?.scope).toEqual({ kind: "day", date: target });
      expect(moved?.repeatSourceId).toBeUndefined();
      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([today]);
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([today]),
      );
    });

    it("rescheduleTaskToDay appends to the anchor's existing excludedDates rather than replacing them", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
        excludedDates: ["2026-07-09"],
      });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: today },
        repeatSourceId: "anchor",
      });
      const { result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("occ", target));

      expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual([
        "2026-07-09",
        today,
      ]);
    });

    it("rescheduleTaskToDay does nothing for a week-scoped task", async () => {
      const task = makeTask({ id: "a", scope: { kind: "week", weekStart: weekStartOf(todayKey()) } });
      const { result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", addDays(todayKey(), 2)));

      expect(result.current.tasks[0]).toBe(task);
    });

    it("rescheduleTaskToDay moves a rolled-over task (week scope with a day rolledFrom), clearing rolledFrom", async () => {
      const today = todayKey();
      const target = addDays(today, 2);
      const rolledOver = makeTask({
        id: "a",
        title: "old task",
        scope: { kind: "week", weekStart: weekStartOf(today) },
        rolledFrom: { kind: "day", date: addDays(today, -2) },
      });
      const { repo, result } = setup(fakeRepository([rolledOver]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", target));

      const moved = result.current.tasks.find((t) => t.id === "a");
      expect(moved?.scope).toEqual({ kind: "day", date: target });
      expect(moved?.rolledFrom).toBeUndefined();
      await waitFor(() =>
        expect(repo.tasks.find((t) => t.id === "a")?.scope).toEqual({ kind: "day", date: target }),
      );
    });

    it("rescheduleTaskToDay is a no-op for a rolled-over task dropped back on its own original date", async () => {
      const today = todayKey();
      const originalDate = addDays(today, -2);
      const rolledOver = makeTask({
        id: "a",
        title: "old task",
        scope: { kind: "week", weekStart: weekStartOf(today) },
        rolledFrom: { kind: "day", date: originalDate },
      });
      const { result } = setup(fakeRepository([rolledOver]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.rescheduleTaskToDay("a", originalDate));

      expect(result.current.tasks[0]).toBe(rolledOver);
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

  describe("bucket list actions", () => {
    it("addBucketItem trims the title, normalizes category casing, and rejects a blank title or category", async () => {
      const existing = makeTask({
        id: "existing",
        scope: { kind: "bucket", category: "To Eat" },
      });
      const { repo, result } = setup(fakeRepository([existing]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => {
        result.current.addBucketItem("  try the new ramen place  ", "to eat"); // case-insensitive match
      });
      await waitFor(() => expect(result.current.tasks).toHaveLength(2));
      const created = result.current.tasks.find((t) => t.id !== "existing")!;
      expect(created.title).toBe("try the new ramen place");
      expect(created.scope).toEqual({ kind: "bucket", category: "To Eat" }); // reused existing casing
      await waitFor(() => expect(repo.tasks).toHaveLength(2));

      act(() => result.current.addBucketItem("   ", "To Go"));
      expect(result.current.tasks).toHaveLength(2); // blank title rejected

      act(() => result.current.addBucketItem("valid title", "   "));
      expect(result.current.tasks).toHaveLength(2); // blank category rejected
    });

    it("setCategory moves a task to a new category and normalizes casing to match existing categories", async () => {
      const task1 = makeTask({ id: "a", scope: { kind: "bucket", category: "To Go" } });
      const task2 = makeTask({ id: "b", scope: { kind: "bucket", category: "To Eat" } });
      const { repo, result } = setup(fakeRepository([task1, task2]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      // Move to a new category with different casing, should match existing "To Eat" and reuse its casing
      act(() => result.current.setCategory("a", "to eat"));
      expect(result.current.tasks[0].scope).toEqual({ kind: "bucket", category: "To Eat" });
      await waitFor(() => expect(repo.tasks[0].scope).toEqual({ kind: "bucket", category: "To Eat" }));
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

  describe("duration action", () => {
    it("setDuration sets and clears the duration", async () => {
      const task = makeTask({ id: "a", time: "09:00", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setDuration("a", 45));
      expect(result.current.tasks[0].durationMinutes).toBe(45);
      await waitFor(() => expect(repo.tasks[0].durationMinutes).toBe(45));

      act(() => result.current.setDuration("a", undefined));
      expect(result.current.tasks[0].durationMinutes).toBeUndefined();
    });
  });

  describe("background action", () => {
    it("setBackground sets and clears the flag", async () => {
      const task = makeTask({ id: "a", time: "08:00", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setBackground("a", true));
      expect(result.current.tasks[0].background).toBe(true);
      await waitFor(() => expect(repo.tasks[0].background).toBe(true));

      act(() => result.current.setBackground("a", false));
      expect(result.current.tasks[0].background).toBe(false);
    });
  });

  describe("due date action", () => {
    it("setDueDate sets and clears the field", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setDueDate("a", "2026-07-31"));
      expect(result.current.tasks[0].dueDate).toBe("2026-07-31");
      await waitFor(() => expect(repo.tasks[0].dueDate).toBe("2026-07-31"));

      act(() => result.current.setDueDate("a", undefined));
      expect(result.current.tasks[0].dueDate).toBeUndefined();
    });

    it("setRepeatWeekdays clears dueDate when weekdays become non-empty", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        dueDate: "2026-07-31",
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", [1, 3]));
      expect(result.current.tasks[0].dueDate).toBeUndefined();
      await waitFor(() => expect(repo.tasks[0].dueDate).toBeUndefined());
    });

    it("setRepeatWeekdays leaves dueDate untouched when weekdays are cleared", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        dueDate: "2026-07-31",
        repeatWeekdays: [1],
      });
      const { result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", []));
      expect(result.current.tasks[0].dueDate).toBe("2026-07-31");
    });
  });

  describe("sync failure handling", () => {
    it("setMemo: on a repo.update rejection, sets syncError and resyncs tasks from a fresh list()", async () => {
      const task = makeTask({ id: "a", memo: "old", scope: { kind: "day", date: todayKey() } });
      const repo = fakeRepository([task]);
      const updateSpy = vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("network down"));
      const { result } = setup(repo);
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setMemo("a", "new"));
      await waitFor(() => expect(result.current.syncError).not.toBeNull());

      // resynced from the server, which never actually received the update
      await waitFor(() => expect(result.current.tasks[0].memo).toBe("old"));
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it("dismissSyncError clears the error without touching tasks", async () => {
      const task = makeTask({ id: "a" });
      const repo = fakeRepository([task]);
      vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("network down"));
      const { result } = setup(repo);
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setPriority("a", true));
      await waitFor(() => expect(result.current.syncError).not.toBeNull());

      act(() => result.current.dismissSyncError());
      expect(result.current.syncError).toBeNull();
    });

    it("coalesces concurrent failures into a single in-flight resync", async () => {
      const a = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const b = makeTask({ id: "b", scope: { kind: "day", date: todayKey() } });
      const repo = fakeRepository([a, b]);

      let releaseResync: ((tasks: Task[]) => void) | undefined;
      const listSpy = vi
        .spyOn(repo, "list")
        .mockResolvedValueOnce([a, b]) // initial load
        .mockImplementationOnce(
          () => new Promise<Task[]>((resolve) => (releaseResync = resolve)), // resync, held open
        );
      const updateSpy = vi.spyOn(repo, "update").mockRejectedValue(new Error("network down"));

      const { result } = setup(repo);
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(listSpy).toHaveBeenCalledTimes(1);

      // Two writes fail back-to-back, as they would during a real outage.
      await act(async () => {
        result.current.setPriority("a", true);
        result.current.setPriority("b", true);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(result.current.syncError).not.toBeNull();
      // Both failures surfaced the banner, but only one resync went out.
      expect(listSpy).toHaveBeenCalledTimes(2);

      // Once the in-flight resync settles, the guard releases for the next one.
      await act(async () => {
        releaseResync?.([a, b]);
        await Promise.resolve();
      });
      await act(async () => {
        result.current.setPriority("a", true);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(3);
    });

    it("initial list() rejection sets syncError and still reaches loaded:true with an empty list", async () => {
      const repo = fakeRepository();
      vi.spyOn(repo, "list").mockRejectedValueOnce(new Error("offline"));

      const { result } = setup(repo);

      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.tasks).toEqual([]);
      expect(result.current.syncError).not.toBeNull();
    });
  });
});
