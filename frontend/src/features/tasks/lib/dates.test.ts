import { describe, expect, it } from "vitest";

import {
  addDays,
  dayLabel,
  dayOfMonth,
  dueDateLabel,
  isOverdue,
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
  upcomingRepeatDates,
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

describe("upcomingRepeatDates", () => {
  it("returns the next N dates matching the given weekdays, starting from `from`", () => {
    // 2026-07-16 is a Thursday; Mon/Wed/Fri next occurrences from there:
    expect(upcomingRepeatDates([1, 3, 5], "2026-07-16", 3)).toEqual([
      "2026-07-17",
      "2026-07-20",
      "2026-07-22",
    ]);
  });

  it("includes `from` itself when its weekday matches", () => {
    // 2026-07-16 is a Thursday (weekday 4)
    expect(upcomingRepeatDates([4], "2026-07-16", 2)).toEqual([
      "2026-07-16",
      "2026-07-23",
    ]);
  });

  it("returns an empty array for count 0 or empty weekdays", () => {
    expect(upcomingRepeatDates([1, 3, 5], "2026-07-16", 0)).toEqual([]);
    expect(upcomingRepeatDates([], "2026-07-16", 3)).toEqual([]);
  });

  it("handles a daily cadence (every weekday present)", () => {
    expect(upcomingRepeatDates([0, 1, 2, 3, 4, 5, 6], "2026-07-16", 3)).toEqual([
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });
});

describe("dueDateLabel", () => {
  it("returns 'Due Today' when the due date is today", () => {
    expect(dueDateLabel("2026-07-16", "2026-07-16")).toBe("Due Today");
  });

  it("returns a weekday name for a due date 1 to 7 days out", () => {
    expect(dueDateLabel("2026-07-17", "2026-07-16")).toBe("Due Fri"); // 1 day out
    expect(dueDateLabel("2026-07-23", "2026-07-16")).toBe("Due Thu"); // 7 days out
  });

  it("returns a short date for a due date more than 7 days out", () => {
    expect(dueDateLabel("2026-07-24", "2026-07-16")).toBe("Due Jul 24"); // 8 days out
    expect(dueDateLabel("2026-08-14", "2026-07-16")).toBe("Due Aug 14");
  });

  it("returns a short date, not a weekday, for an already-past due date", () => {
    expect(dueDateLabel("2026-07-14", "2026-07-16")).toBe("Due Jul 14"); // 2 days ago
  });
});

describe("isOverdue", () => {
  it("is false when the due date is today", () => {
    expect(isOverdue("2026-07-16", "2026-07-16")).toBe(false);
  });

  it("is false when the due date is in the future", () => {
    expect(isOverdue("2026-07-17", "2026-07-16")).toBe(false);
  });

  it("is true when the due date is in the past", () => {
    expect(isOverdue("2026-07-15", "2026-07-16")).toBe(true);
  });
});
