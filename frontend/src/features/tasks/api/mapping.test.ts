import { describe, expect, it } from "vitest";

import { fromApiPayload, toApiPayload, type ApiTask } from "./mapping";
import type { Task } from "../types";

const fullApiTask: ApiTask = {
  id: "a1",
  title: "write plan",
  memo: "details",
  done: true,
  scope_kind: "day",
  scope_value: "2026-07-27",
  rolled_from_kind: "day",
  rolled_from_value: "2026-07-20",
  created_at: "2026-07-27T00:00:00.000Z",
  completed_at: "2026-07-27T09:00:00.000Z",
  time: "09:30",
  due_date: "2026-08-01",
  subtasks: [{ id: "s1", title: "buy wood", done: false }],
  repeat_weekdays: [1, 3, 5],
  repeat_source: "anchor-1",
  excluded_dates: ["2026-07-13"],
  priority: true,
  duration_minutes: 45,
  background: true,
};

const fullTask: Task = {
  id: "a1",
  title: "write plan",
  memo: "details",
  done: true,
  scope: { kind: "day", date: "2026-07-27" },
  rolledFrom: { kind: "day", date: "2026-07-20" },
  createdAt: "2026-07-27T00:00:00.000Z",
  completedAt: "2026-07-27T09:00:00.000Z",
  time: "09:30",
  dueDate: "2026-08-01",
  subtasks: [{ id: "s1", title: "buy wood", done: false }],
  repeatWeekdays: [1, 3, 5],
  repeatSourceId: "anchor-1",
  excludedDates: ["2026-07-13"],
  priority: true,
  durationMinutes: 45,
  background: true,
};

describe("fromApiPayload", () => {
  it("maps every field from a fully-populated ApiTask", () => {
    expect(fromApiPayload(fullApiTask)).toEqual(fullTask);
  });

  it("maps nulls to undefined for optional fields, and omits rolledFrom when either half is null", () => {
    const minimal: ApiTask = {
      id: "b1",
      title: "solo",
      memo: null,
      done: false,
      scope_kind: "week",
      scope_value: "2026-07-19",
      rolled_from_kind: null,
      rolled_from_value: null,
      created_at: "2026-07-27T00:00:00.000Z",
      completed_at: null,
      time: null,
      due_date: null,
      subtasks: [],
      repeat_weekdays: null,
      repeat_source: null,
      excluded_dates: null,
      priority: null,
      duration_minutes: null,
      background: null,
    };

    const task = fromApiPayload(minimal);

    expect(task.memo).toBeUndefined();
    expect(task.rolledFrom).toBeUndefined();
    expect(task.time).toBeUndefined();
    expect(task.dueDate).toBeUndefined();
    expect(task.repeatWeekdays).toBeUndefined();
    expect(task.repeatSourceId).toBeUndefined();
    expect(task.excludedDates).toBeUndefined();
    expect(task.priority).toBeUndefined();
    expect(task.durationMinutes).toBeUndefined();
    expect(task.background).toBeUndefined();
    expect(task.scope).toEqual({ kind: "week", weekStart: "2026-07-19" });
  });
});

describe("toApiPayload", () => {
  it("maps every field from a fully-populated Task", () => {
    expect(toApiPayload(fullTask)).toEqual(fullApiTask);
  });

  it("maps undefined to null for optional fields, and both rolled_from_* to null when rolledFrom is unset", () => {
    const minimal: Task = {
      id: "b1",
      title: "solo",
      done: false,
      scope: { kind: "month", month: "2026-07" },
      createdAt: "2026-07-27T00:00:00.000Z",
    };

    const payload = toApiPayload(minimal);

    expect(payload.memo).toBeNull();
    expect(payload.rolled_from_kind).toBeNull();
    expect(payload.rolled_from_value).toBeNull();
    expect(payload.time).toBeNull();
    expect(payload.due_date).toBeNull();
    expect(payload.subtasks).toEqual([]);
    expect(payload.repeat_weekdays).toBeNull();
    expect(payload.repeat_source).toBeNull();
    expect(payload.excluded_dates).toBeNull();
    expect(payload.priority).toBeNull();
    expect(payload.duration_minutes).toBeNull();
    expect(payload.background).toBeNull();
    expect(payload.scope_kind).toBe("month");
    expect(payload.scope_value).toBe("2026-07");
  });

  it("round-trips a year-scoped task", () => {
    const yearTask: Task = {
      id: "c1",
      title: "yearly review",
      done: false,
      scope: { kind: "year", year: "2026" },
      createdAt: "2026-07-27T00:00:00.000Z",
    };

    expect(fromApiPayload(toApiPayload(yearTask))).toEqual(yearTask);
  });
});
