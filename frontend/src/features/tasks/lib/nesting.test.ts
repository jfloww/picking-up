import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { lostFieldsFor, nestBlockMessage, nestBlockReasonFor } from "./nesting";

describe("nestBlockReasonFor", () => {
  it("returns undefined for a plain task", () => {
    expect(nestBlockReasonFor(makeTask({}))).toBeUndefined();
  });

  it("returns has-subtasks for a task with its own subtasks", () => {
    expect(
      nestBlockReasonFor(makeTask({ subtasks: [{ id: "s1", title: "x", done: false }] })),
    ).toBe("has-subtasks");
  });

  it("returns repeating for a recurring anchor", () => {
    expect(nestBlockReasonFor(makeTask({ repeatWeekdays: [1, 3] }))).toBe("repeating");
  });

  it("returns repeating for a generated occurrence", () => {
    expect(nestBlockReasonFor(makeTask({ repeatSourceId: "anchor-1" }))).toBe("repeating");
  });

  it("has-subtasks takes priority when both apply", () => {
    expect(
      nestBlockReasonFor(
        makeTask({ subtasks: [{ id: "s1", title: "x", done: false }], repeatWeekdays: [1] }),
      ),
    ).toBe("has-subtasks");
  });
});

describe("nestBlockMessage", () => {
  it("has a distinct message per reason", () => {
    expect(nestBlockMessage("has-subtasks")).toMatch(/subtasks/);
    expect(nestBlockMessage("repeating")).toMatch(/series/i);
  });
});

describe("lostFieldsFor", () => {
  it("returns an empty array for a plain task", () => {
    expect(lostFieldsFor(makeTask({}))).toEqual([]);
  });

  it("lists every field that would be lost, in a stable order", () => {
    expect(
      lostFieldsFor(
        makeTask({
          memo: "call the plumber",
          completedAt: "2026-08-06T12:00:00.000Z",
          time: "09:00",
          durationMinutes: 30,
          priority: true,
          dueDate: "2026-08-10",
          background: true,
        }),
      ),
    ).toEqual([
      "note",
      "completion time",
      "time",
      "duration",
      "priority",
      "due date",
      "background",
    ]);
  });

  it("omits fields that aren't set", () => {
    expect(lostFieldsFor(makeTask({ priority: true }))).toEqual(["priority"]);
  });

  it("includes rollover and exclusion history that a subtask cannot represent", () => {
    expect(
      lostFieldsFor(
        makeTask({
          rolledFrom: { kind: "day", date: "2026-08-05" },
          excludedDates: ["2026-08-04"],
        }),
      ),
    ).toEqual(["rollover history", "excluded routine dates"]);
  });
});
