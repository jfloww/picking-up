import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { materializeRoutines } from "./routines";

const TODAY = "2026-07-16"; // Thursday -> weekday index 4

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "anchor",
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-01" },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("materializeRoutines", () => {
  it("creates today's occurrence when the weekday matches and none exists yet", () => {
    const anchor = makeTask({ repeatWeekdays: [4] });
    const [spawned] = materializeRoutines([anchor], TODAY);
    expect(spawned).toMatchObject({
      title: "task",
      done: false,
      scope: { kind: "day", date: TODAY },
      repeatSourceId: "anchor",
    });
  });

  it("copies the anchor's current title/time/memo at generation time", () => {
    const anchor = makeTask({
      repeatWeekdays: [4],
      title: "updated title",
      time: "08:00",
      memo: "updated memo",
    });
    const [spawned] = materializeRoutines([anchor], TODAY);
    expect(spawned.title).toBe("updated title");
    expect(spawned.time).toBe("08:00");
    expect(spawned.memo).toBe("updated memo");
  });

  it("does not duplicate if today's occurrence already exists", () => {
    const anchor = makeTask({ repeatWeekdays: [4] });
    const existing = makeTask({
      id: "occ1",
      scope: { kind: "day", date: TODAY },
      repeatSourceId: "anchor",
    });
    expect(materializeRoutines([anchor, existing], TODAY)).toEqual([]);
  });

  it("does not spawn a duplicate when the anchor itself is already scoped to today", () => {
    const anchor = makeTask({
      repeatWeekdays: [4],
      scope: { kind: "day", date: TODAY },
    });
    expect(materializeRoutines([anchor], TODAY)).toEqual([]);
  });

  it("ignores anchors whose weekday does not match today", () => {
    const anchor = makeTask({ repeatWeekdays: [1, 3, 5] }); // Mon/Wed/Fri, not Thu
    expect(materializeRoutines([anchor], TODAY)).toEqual([]);
  });

  it("ignores plain tasks with no repeatWeekdays", () => {
    const plain = makeTask({});
    expect(materializeRoutines([plain], TODAY)).toEqual([]);
  });

  it("materializes from a week-scoped anchor (rolled out of day scope)", () => {
    const anchor = makeTask({
      scope: { kind: "week", weekStart: "2026-07-12" },
      repeatWeekdays: [4],
    });
    const [spawned] = materializeRoutines([anchor], TODAY);
    expect(spawned).toMatchObject({
      title: "task",
      scope: { kind: "day", date: TODAY },
      repeatSourceId: "anchor",
    });
  });

  it("does not spawn for a date in the anchor's excludedDates, even if it otherwise matches", () => {
    const anchor = makeTask({
      repeatWeekdays: [4],
      excludedDates: [TODAY],
    });
    expect(materializeRoutines([anchor], TODAY)).toEqual([]);
  });
});
