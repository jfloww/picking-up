import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Task } from "../types";
import { compareTasksForDay, isValidTime, nowTime, timeToMinutes } from "./times";

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
