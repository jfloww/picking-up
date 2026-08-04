import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Task } from "../types";
import {
  addMinutesToTime,
  compareTasksForDay,
  dayTasksForWeek,
  isPastToday,
  isValidTime,
  layoutTimedTasks,
  monthStats,
  nowTime,
  repeatCadenceLabel,
  repeatLabelForTask,
  resolveRepeatWeekdays,
  timeToMinutes,
  weeklyRollupTasks,
  weekStats,
  yToSnappedTime,
} from "./times";

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    title: "t",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    order: 0,
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

describe("addMinutesToTime", () => {
  it("adds minutes within the same day", () => {
    expect(addMinutesToTime("09:00", 45)).toBe("09:45");
    expect(addMinutesToTime("09:30", 90)).toBe("11:00");
  });

  it("wraps past midnight", () => {
    expect(addMinutesToTime("23:30", 45)).toBe("00:15");
  });

  it("returns the same time for a zero-minute addition", () => {
    expect(addMinutesToTime("14:00", 0)).toBe("14:00");
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

  it("returns 0 for two untimed tasks with equal order", () => {
    expect(compareTasksForDay(task({ order: 5 }), task({ order: 5 }))).toBe(0);
  });

  it("breaks ties between two untimed tasks by order", () => {
    const first = task({ order: 1 });
    const second = task({ order: 2 });
    expect([second, first].sort(compareTasksForDay)).toEqual([first, second]);
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
      order: 0,
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

  it("splits tasks with different start times into side-by-side columns when their durations overlap", () => {
    const long = task({ time: "08:00", durationMinutes: 540 }); // 8:00-17:00
    const short = task({ time: "09:00", durationMinutes: 60 }); // 9:00-10:00, inside `long`
    expect(layoutTimedTasks([long, short])).toEqual([
      { task: long, column: 0, columns: 2 },
      { task: short, column: 1, columns: 2 },
    ]);
  });

  it("does not treat back-to-back tasks (end == next start) as overlapping", () => {
    const a = task({ time: "09:00", durationMinutes: 60 }); // ends 10:00
    const b = task({ time: "10:00", durationMinutes: 60 }); // starts exactly when a ends
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 1 },
      { task: b, column: 0, columns: 1 },
    ]);
  });

  it("gives a duration-less task a 30-minute nominal footprint, so a start inside that window overlaps", () => {
    const a = task({ time: "09:00" }); // no duration -> nominal 09:00-09:30
    const b = task({ time: "09:15" }); // falls inside a's nominal window
    expect(layoutTimedTasks([a, b])).toEqual([
      { task: a, column: 0, columns: 2 },
      { task: b, column: 1, columns: 2 },
    ]);
  });

  it("does not overlap a duration-less task with one starting exactly when its nominal window ends", () => {
    const a = task({ time: "09:00" }); // no duration -> nominal 09:00-09:30
    const c = task({ time: "09:30" });
    expect(layoutTimedTasks([a, c])).toEqual([
      { task: a, column: 0, columns: 1 },
      { task: c, column: 0, columns: 1 },
    ]);
  });

  it("computes the column count dynamically for 3+ concurrent tasks, not capped at 2", () => {
    const a = task({ time: "09:00", durationMinutes: 60 });
    const b = task({ time: "09:15", durationMinutes: 60 });
    const c = task({ time: "09:30", durationMinutes: 60 });
    const layout = layoutTimedTasks([a, b, c]);
    expect(layout.every((l) => l.columns === 3)).toBe(true);
    expect(new Set(layout.map((l) => l.column))).toEqual(new Set([0, 1, 2]));
  });

  it("reuses a freed column once its occupant ends, instead of growing columns unnecessarily", () => {
    const a = task({ time: "09:00", durationMinutes: 30 }); // 9:00-9:30
    const b = task({ time: "09:15", durationMinutes: 15 }); // 9:15-9:30, overlaps a
    const c = task({ time: "09:30", durationMinutes: 30 }); // starts once both have ended
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

describe("repeatCadenceLabel", () => {
  it("returns Daily for all 7 weekdays", () => {
    expect(repeatCadenceLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Daily");
  });

  it("returns Weekdays for exactly Mon-Fri", () => {
    expect(repeatCadenceLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
  });

  it("abbreviates a specific, non-standard set of days", () => {
    expect(repeatCadenceLabel([5, 1, 3])).toBe("Mo/We/Fr"); // unsorted input
  });

  it("handles a single day", () => {
    expect(repeatCadenceLabel([0])).toBe("Su");
  });
});

describe("repeatLabelForTask", () => {
  it("labels an anchor task from its own repeatWeekdays", () => {
    const anchor = task({ repeatWeekdays: [1, 2, 3, 4, 5] });
    expect(repeatLabelForTask(anchor, [anchor])).toBe("Weekdays");
  });

  it("labels a generated instance by resolving its anchor via repeatSourceId", () => {
    const anchor = task({ id: "anchor", repeatWeekdays: [0, 6] });
    const instance = task({ id: "inst", repeatSourceId: "anchor" });
    expect(repeatLabelForTask(instance, [anchor, instance])).toBe("Su/Sa");
  });

  it("returns undefined for a non-repeating task", () => {
    const plain = task({});
    expect(repeatLabelForTask(plain, [plain])).toBeUndefined();
  });

  it("returns undefined when the anchor can't be found", () => {
    const orphan = task({ repeatSourceId: "missing" });
    expect(repeatLabelForTask(orphan, [orphan])).toBeUndefined();
  });
});

describe("resolveRepeatWeekdays", () => {
  it("resolves an anchor task's own repeatWeekdays", () => {
    const anchor = task({ repeatWeekdays: [1, 3, 5] });
    expect(resolveRepeatWeekdays(anchor, [anchor])).toEqual([1, 3, 5]);
  });

  it("resolves a generated instance's weekdays via its anchor's repeatSourceId", () => {
    const anchor = task({ id: "anchor", repeatWeekdays: [0, 6] });
    const instance = task({ id: "inst", repeatSourceId: "anchor" });
    expect(resolveRepeatWeekdays(instance, [anchor, instance])).toEqual([0, 6]);
  });

  it("returns undefined for a non-repeating task", () => {
    const plain = task({});
    expect(resolveRepeatWeekdays(plain, [plain])).toBeUndefined();
  });

  it("returns undefined when the anchor can't be found", () => {
    const orphan = task({ repeatSourceId: "missing" });
    expect(resolveRepeatWeekdays(orphan, [orphan])).toBeUndefined();
  });
});

describe("weekStats", () => {
  const weekStart = "2026-07-12"; // Sunday

  it("counts day-scoped tasks within the week and week-scoped tasks for it", () => {
    const dayTask = task({ scope: { kind: "day", date: "2026-07-14" } });
    const weekTask = task({ scope: { kind: "week", weekStart } });
    const outside = task({ scope: { kind: "day", date: "2026-07-20" } });
    const result = weekStats([dayTask, weekTask, outside], weekStart);
    expect(result).toEqual({ done: 0, total: 2 });
  });

  it("counts done tasks separately from total", () => {
    const done = task({ scope: { kind: "day", date: "2026-07-14" }, done: true });
    const undone = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    expect(weekStats([done, undone], weekStart)).toEqual({ done: 1, total: 2 });
  });

  it("excludes a week-scoped task rolled over from a different (earlier) week", () => {
    const staleRollover = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-06-28" }, // two weeks before weekStart
    });
    expect(weekStats([staleRollover], weekStart)).toEqual({ done: 0, total: 0 });
  });

  it("includes a week-scoped task rolled over from within this same week", () => {
    const sameWeekRollover = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-07-14" }, // within weekStart's week
    });
    expect(weekStats([sameWeekRollover], weekStart)).toEqual({ done: 0, total: 1 });
  });

  it("includes a genuine week-level task with no rolledFrom", () => {
    const genuine = task({ scope: { kind: "week", weekStart } });
    expect(weekStats([genuine], weekStart)).toEqual({ done: 0, total: 1 });
  });
});

describe("dayTasksForWeek", () => {
  const weekStart = "2026-07-12"; // Sunday
  const date = "2026-07-14"; // Tuesday, in that week

  it("includes a task still day-scoped on that date", () => {
    const t = task({ scope: { kind: "day", date } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([t]);
  });

  it("includes a week-scoped task rolled over from that date", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date },
    });
    expect(dayTasksForWeek([rolled], date, weekStart)).toEqual([rolled]);
  });

  it("excludes a week-scoped task rolled over from a different date", () => {
    const rolled = task({
      scope: { kind: "week", weekStart },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    expect(dayTasksForWeek([rolled], date, weekStart)).toEqual([]);
  });

  it("excludes a day-scoped task on a different date", () => {
    const t = task({ scope: { kind: "day", date: "2026-07-15" } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([]);
  });

  it("excludes a genuine week-level task with no rolledFrom", () => {
    const t = task({ scope: { kind: "week", weekStart } });
    expect(dayTasksForWeek([t], date, weekStart)).toEqual([]);
  });
});

describe("isPastToday", () => {
  it("is true when the date is today and the time has already passed", () => {
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "14:05")).toBe(true);
  });

  it("is false when the date is today but the time hasn't arrived yet", () => {
    expect(isPastToday("15:00", "2026-07-16", "2026-07-16", "14:05")).toBe(false);
  });

  it("is false when the date isn't today, regardless of time", () => {
    expect(isPastToday("09:00", "2026-07-15", "2026-07-16", "14:05")).toBe(false);
    expect(isPastToday("09:00", "2026-07-17", "2026-07-16", "14:05")).toBe(false);
  });

  it("is false at the exact current minute (not past yet)", () => {
    expect(isPastToday("14:05", "2026-07-16", "2026-07-16", "14:05")).toBe(false);
  });

  it("is false once the task has started but its duration hasn't elapsed yet", () => {
    // Starts 09:00, runs 30 min -> ends 09:30. It's 09:15: started, not overdue.
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "09:15", 30)).toBe(false);
  });

  it("is true once the task's end time (start + duration) has passed", () => {
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "09:31", 30)).toBe(true);
  });

  it("is false at the exact end minute (not past yet)", () => {
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "09:30", 30)).toBe(false);
  });

  it("falls back to the start time alone when no duration is given", () => {
    expect(isPastToday("09:00", "2026-07-16", "2026-07-16", "09:15")).toBe(true);
  });
});

describe("monthStats", () => {
  const monthKey = "2026-07";

  it("counts day-scoped tasks within the month and week-scoped rollover tasks whose rolledFrom date is within it", () => {
    const dayTask = task({ scope: { kind: "day", date: "2026-07-14" } });
    const rolled = task({
      scope: { kind: "week", weekStart: "2026-07-12" },
      rolledFrom: { kind: "day", date: "2026-07-13" },
    });
    const outside = task({ scope: { kind: "day", date: "2026-08-02" } });
    const result = monthStats([dayTask, rolled, outside], monthKey);
    expect(result).toEqual({ done: 0, total: 2 });
  });

  it("counts done tasks separately from total", () => {
    const done = task({ scope: { kind: "day", date: "2026-07-14" }, done: true });
    const undone = task({ scope: { kind: "day", date: "2026-07-15" }, done: false });
    expect(monthStats([done, undone], monthKey)).toEqual({ done: 1, total: 2 });
  });

  it("does not count a task from an adjacent month even if it appears in the grid's padding", () => {
    const juneTask = task({ scope: { kind: "day", date: "2026-06-28" } });
    const augustTask = task({ scope: { kind: "day", date: "2026-08-01" } });
    expect(monthStats([juneTask, augustTask], monthKey)).toEqual({ done: 0, total: 0 });
  });

  it("counts a month-scoped task for the target month", () => {
    const goal = task({ scope: { kind: "month", month: monthKey } });
    expect(monthStats([goal], monthKey)).toEqual({ done: 0, total: 1 });
  });

  it("does not count a month-scoped task belonging to a different month", () => {
    const otherMonthGoal = task({ scope: { kind: "month", month: "2026-08" } });
    expect(monthStats([otherMonthGoal], monthKey)).toEqual({ done: 0, total: 0 });
  });
});

describe("bucket-scoped tasks don't leak into day/week/month filters", () => {
  it("is excluded from weekStats and monthStats", () => {
    const bucketTask = task({
      id: "b1",
      done: false,
      scope: { kind: "bucket", categoryId: "cat-eat" },
    });
    expect(weekStats([bucketTask], "2026-07-12")).toEqual({ total: 0, done: 0 });
    expect(monthStats([bucketTask], "2026-07")).toEqual({ total: 0, done: 0 });
  });

  it("is excluded from dayTasksForWeek", () => {
    const bucketTask = task({
      id: "b1",
      scope: { kind: "bucket", categoryId: "cat-eat" },
    });
    expect(dayTasksForWeek([bucketTask], "2026-07-16", "2026-07-12")).toEqual([]);
  });
});
