import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Task } from "../types";
import { compareTasksForDay, isValidTime, layoutTimedTasks, nowTime, timeToMinutes, weeklyRollupTasks, yToSnappedTime } from "./times";

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    title: "t",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("isValidTime", () => {
  it("accepts zero-padded 24h times and rejects everything else", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("09:30")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
    expect(isValidTime("")).toBe(false);
    expect(isValidTime("nine")).toBe(false);
  });
});

describe("nowTime", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns the current zero-padded HH:MM", () => {
    expect(nowTime()).toBe("14:05");
  });
});

describe("timeToMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("compareTasksForDay", () => {
  it("orders timed before untimed, timed ascending by time", () => {
    const nine = task({ time: "09:00" });
    const noon = task({ time: "12:00" });
    const untimed = task({});
    const sorted = [untimed, noon, nine].sort(compareTasksForDay);
    expect(sorted).toEqual([nine, noon, untimed]);
  });

  it("returns 0 for two untimed tasks (stable sort keeps insertion order)", () => {
    expect(compareTasksForDay(task({}), task({}))).toBe(0);
  });
});

describe("yToSnappedTime", () => {
  it("converts a content-relative y offset to a snapped HH:MM", () => {
    expect(yToSnappedTime(456, 48)).toBe("09:30"); // 570 minutes exactly
    expect(yToSnappedTime(0, 48)).toBe("00:00");
  });

  it("rounds to the nearest 15-minute slot", () => {
    expect(yToSnappedTime(457.6, 48)).toBe("09:30"); // 572 min -> rounds down to 570
    expect(yToSnappedTime(462.4, 48)).toBe("09:45"); // 578 min -> rounds up to 585
  });

  it("clamps to 00:00..23:45", () => {
    expect(yToSnappedTime(-50, 48)).toBe("00:00");
    expect(yToSnappedTime(100000, 48)).toBe("23:45");
  });

  it("honors a custom snap grid", () => {
    expect(yToSnappedTime(456, 48, 30)).toBe("09:30");
    expect(yToSnappedTime(464, 48, 30)).toBe("09:30"); // 580 min -> nearest 30 is 570, not a tie
  });
});

describe("layoutTimedTasks", () => {
  function task(overrides: Partial<Task>): Task {
    return {
      id: crypto.randomUUID(),
      title: "t",
      done: false,
      scope: { kind: "day", date: "2026-07-16" },
      createdAt: "2026-07-16T00:00:00.000Z",
      ...overrides,
    };
  }

  it("gives unique-time tasks a single full-width column", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "10:00" });
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 1 },
      { task: b, column: 0, columns: 1 },
    ]);
  });

  it("splits same-time tasks into indexed columns", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "09:00" });
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 2 },
      { task: b, column: 1, columns: 2 },
    ]);
  });

  it("groups independently by time when some tasks collide and others don't", () => {
    const a = task({ time: "09:00" });
    const b = task({ time: "09:00" });
    const c = task({ time: "11:00" });
    expect(layoutTimedTasks([a, b, c])).toEqual([
      { task: a, column: 0, columns: 2 },
      { task: b, column: 1, columns: 2 },
      { task: c, column: 0, columns: 1 },
    ]);
  });
});

describe("weeklyRollupTasks", () => {
  const weekStart = "2026-07-12"; // Sunday

  it("includes week-level tasks in the week, excludes tasks from other weeks", () => {
    const inWeek = task({ scope: { kind: "week", weekStart } });
    const otherWeek = task({ scope: { kind: "week", weekStart: "2026-07-19" } });
    const result = weeklyRollupTasks([inWeek, otherWeek], weekStart);
    expect(result.map((r) => r.task.id)).toEqual([inWeek.id]);
  });

  it("includes unfinished day tasks in the week, excludes done ones and tasks outside the week", () => {
    const undone = task({ scope: { kind: "day", date: "2026-07-14" }, done: false });
    const done = task({ scope: { kind: "day", date: "2026-07-15" }, done: true });
    const outside = task({ scope: { kind: "day", date: "2026-07-20" }, done: false }); // next week
    const result = weeklyRollupTasks([undone, done, outside], weekStart);
    expect(result.map((r) => r.task.id)).toEqual([undone.id]);
  });

  it("dates a rolled-over week task from rolledFrom.date, and a genuine week task as null", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    const genuine = task({ scope: { kind: "week", weekStart } });
    const result = weeklyRollupTasks([genuine, rolled], weekStart);
    expect(result.find((r) => r.task.id === rolled.id)?.date).toBe("2026-07-13");
    expect(result.find((r) => r.task.id === genuine.id)?.date).toBeNull();
  });

  it("sorts by date then time, dateless tasks last", () => {
    const later = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    const earlierTimed = task({
      scope: { kind: "day", date: "2026-07-14" },
      time: "09:00",
      done: false,
    });
    const earlierUntimed = task({ scope: { kind: "day", date: "2026-07-14" }, done: false });
    const dateless = task({ scope: { kind: "week", weekStart } });
    const result = weeklyRollupTasks(
      [later, earlierUntimed, earlierTimed, dateless],
      weekStart,
    );
    expect(result.map((r) => r.task.id)).toEqual([
      earlierTimed.id,
      earlierUntimed.id,
      later.id,
      dateless.id,
    ]);
  });
});
