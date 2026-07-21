import type { Task } from "../types";
import { monthKeyOf, weekStartOf } from "./dates";

export function rolloverTasks(tasks: Task[], today: string): Task[] {
  const currentWeek = weekStartOf(today);
  const currentMonth = monthKeyOf(today);

  return tasks.map((task) => {
    if (task.done) return task;
    if (task.repeatSourceId !== undefined) return task;

    let scope = task.scope;
    if (scope.kind === "day" && scope.date < today) {
      scope = { kind: "week", weekStart: weekStartOf(scope.date) };
    }
    if (scope.kind === "week" && scope.weekStart < currentWeek) {
      scope = { kind: "week", weekStart: currentWeek };
    }
    if (scope.kind === "month" && scope.month < currentMonth) {
      scope = { kind: "month", month: currentMonth };
    }
    if (scope === task.scope) return task;

    return { ...task, scope, rolledFrom: task.rolledFrom ?? task.scope };
  });
}
