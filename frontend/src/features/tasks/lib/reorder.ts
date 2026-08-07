import type { Task } from "../types";

// Fractional ordering: a drag only ever changes the single dragged task's
// order to a value between its new neighbors, so exactly one task updates
// per reorder instead of renumbering the whole list. `before`/`after` are
// the order values of the tasks immediately above/below the drop position
// (undefined at either edge of the list).
const EDGE_GAP = 1;

export function computeOrderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - EDGE_GAP;
  if (after === undefined) return before + EDGE_GAP;
  return (before + after) / 2;
}

// Appends to the end of a day's untimed All Day To-Do list — the shared
// ordering rule for a freshly created untimed task (addTask) and for a
// subtask promoted out from under a timed parent (promotedSubtaskOrder's
// timed-parent branch), which has no natural sibling to land next to.
export function nextUntimedOrderFor(tasks: Task[], date: string): number {
  return (
    Math.max(
      0,
      ...tasks
        .filter((t) => t.scope.kind === "day" && t.scope.date === date && !t.time && !t.done)
        .map((t) => t.order),
    ) + 1
  );
}

// Shared by the store's optimistic update and every TaskRepository
// implementation (localStorage, the in-memory test fake) so the promoted
// task's position agrees everywhere instead of three independently
// maintained copies of the same rule (RF-005 review finding). The
// canonical, authoritative calculation still happens server-side in
// services.py's _promotion_order — this is the client-side mirror used for
// optimistic UI state and offline/test repositories.
export function promotedSubtaskOrder(tasks: Task[], parent: Task): number {
  const scope = parent.scope;
  if (scope.kind !== "day") return 0;

  if (parent.time) {
    // Parent is timed (Next Up) — the promoted task is always untimed
    // regardless, so there's no natural sibling to land next to; append to
    // the end of All Day To-Do for that day, same as a fresh untimed task.
    return nextUntimedOrderFor(tasks, scope.date);
  }

  // Parent lives in All Day To-Do — insert the promoted task directly
  // after it.
  const nextSibling = tasks
    .filter(
      (t) =>
        t.scope.kind === "day" &&
        t.scope.date === scope.date &&
        !t.time &&
        !t.done &&
        t.order > parent.order,
    )
    .sort((a, b) => a.order - b.order)[0];
  return computeOrderBetween(parent.order, nextSibling?.order);
}
