import { describe, expect, it } from "vitest";

import {
  addDays,
  dayLabel,
  dayOfMonth,
  monthGrid,
  monthKeyOf,
  monthKeys,
  monthLabel,
  monthName,
  nextMonthKey,
  prevMonthKey,
  shortDateLabel,
  todayKey,
  weekDates,
  weekdayOf,
  weekRangeLabel,
  weekStartOf,
  yearOf,
} from "./dates";

describe("dates", () => {
  it("todayKey returns YYYY-MM-DD", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-07-16", 1)).toBe("2026-07-17");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("dayOfMonth extracts the day number", () => {
    expect(dayOfMonth("2026-07-05")).toBe(5);
    expect(dayOfMonth("2026-07-16")).toBe(16);
  });

  it("weekStartOf returns the Sunday of the week", () => {
    expect(weekStartOf("2026-07-16")).toBe("2026-07-12"); // Thursday -> Sunday
    expect(weekStartOf("2026-07-12")).toBe("2026-07-12"); // Sunday is its own start
    expect(weekStartOf("2026-07-01")).toBe("2026-06-28"); // week spans two months
  });

  it("weekdayOf returns a getDay()-style index", () => {
    expect(weekdayOf("2026-07-16")).toBe(4); // Thursday
    expect(weekdayOf("2026-07-12")).toBe(0); // Sunday
  });

  it("weekDates returns 7 consecutive days", () => {
    expect(weekDates("2026-07-12")).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });

  it("monthKeyOf / yearOf slice the key", () => {
    expect(monthKeyOf("2026-07-16")).toBe("2026-07");
    expect(yearOf("2026-07-16")).toBe("2026");
  });

  it("nextMonthKey and prevMonthKey handle year boundaries", () => {
    expect(nextMonthKey("2026-07")).toBe("2026-08");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(prevMonthKey("2026-07")).toBe("2026-06");
    expect(prevMonthKey("2026-01")).toBe("2025-12");
  });

  it("monthKeys returns 12 padded keys", () => {
    const keys = monthKeys("2026");
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2026-01");
    expect(keys[11]).toBe("2026-12");
  });

  it("monthGrid builds Su-Sa rows with null padding", () => {
    const grid = monthGrid("2026-07"); // 2026-07-01 is a Wednesday
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      null,
      null,
      null,
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(grid[2][0]).toBe("2026-07-12");
    expect(grid[4]).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      null,
    ]);
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it("monthLabel and monthName format for display", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthName("2026-01")).toBe("January");
  });
});

describe("dayLabel", () => {
  it("formats a full day heading", () => {
    expect(dayLabel("2026-07-16")).toBe("Thursday, July 16");
  });
});

describe("shortDateLabel", () => {
  it("returns Today when the date matches today", () => {
    expect(shortDateLabel("2026-07-16", "2026-07-16")).toBe("Today");
  });

  it("returns a short weekday/month/day form otherwise", () => {
    expect(shortDateLabel("2026-07-20", "2026-07-16")).toBe("Mon Jul 20");
  });
});

describe("weekRangeLabel", () => {
  it("formats a week within a single month", () => {
    expect(weekRangeLabel("2026-07-12")).toBe("Jul 12 – Jul 18");
  });

  it("formats a week spanning two months", () => {
    expect(weekRangeLabel("2026-06-28")).toBe("Jun 28 – Jul 4");
  });
});
