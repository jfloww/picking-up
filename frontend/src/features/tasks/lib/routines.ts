import type { Task } from "../types";
import { weekdayOf } from "./dates";

export function materializeRoutines(tasks: Task[], today: string): Task[] {
  const todayWeekday = weekdayOf(today);

  const anchors = tasks.filter(
    (t): t is Task & { repeatWeekdays: number[] } =>
      t.repeatWeekdays !== undefined && t.repeatWeekdays.includes(todayWeekday),
  );

  return anchors
    .filter((anchor) => {
      // The anchor's own day already covers `today` if that's where it lives —
      // without this check, the very day repeat is turned on would spawn a
      // second, duplicate occurrence alongside the anchor itself.
      if (anchor.scope.kind === "day" && anchor.scope.date === today) return false;
      if (anchor.excludedDates?.includes(today)) return false;
      return !tasks.some(
        (t) =>
          t.repeatSourceId === anchor.id &&
          t.scope.kind === "day" &&
          t.scope.date === today,
      );
    })
    .map((anchor) => ({
      id: crypto.randomUUID(),
      title: anchor.title,
      memo: anchor.memo,
      time: anchor.time,
      done: false,
      scope: { kind: "day", date: today },
      order: 0,
      repeatSourceId: anchor.id,
      createdAt: new Date().toISOString(),
      version: 1,
    }));
}
