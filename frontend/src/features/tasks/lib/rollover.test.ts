import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { rolloverTasks } from "./rollover";

const TODAY = "2026-07-16"; // Thursday; current week starts 2026-07-12

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "task",
    done: false,
    scope: { kind: "day", date: TODAY },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rolloverTasks", () => {
  it("moves an unfinished past day task into its week's weekly cell", () => {
    const task = makeTask({ scope: { kind: "day", date: "2026-07-14" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-14" });
  });

  it("keeps rolling a day task from an older week into the current week", () => {
    const task = makeTask({ scope: { kind: "day", date: "2026-07-03" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-03" });
  });

  it("moves an unfinished past week task into the current week", () => {
    const task = makeTask({ scope: { kind: "week", weekStart: "2026-07-05" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
  });

  it("preserves the original rolledFrom across repeated rolls", () => {
    const task = makeTask({
      scope: { kind: "week", weekStart: "2026-07-05" },
      rolledFrom: { kind: "day", date: "2026-07-01" },
    });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-01" });
  });

  it("moves an unfinished past month task into the current month", () => {
    const task = makeTask({ scope: { kind: "month", month: "2026-05" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "month", month: "2026-07" });
  });

  it("never touches done, current, future, or year tasks", () => {
    const done = makeTask({
      id: "done",
      done: true,
      scope: { kind: "day", date: "2026-07-01" },
    });
    const today = makeTask({ id: "today" });
    const future = makeTask({
      id: "future",
      scope: { kind: "day", date: "2026-07-20" },
    });
    const year = makeTask({ id: "year", scope: { kind: "year", year: "2025" } });
    const input = [done, today, future, year];
    const result = rolloverTasks(input, TODAY);
    // same references — nothing moved
    for (let i = 0; i < input.length; i++) expect(result[i]).toBe(input[i]);
  });
});
