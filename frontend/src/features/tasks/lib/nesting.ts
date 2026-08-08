import type { Task } from "../types";

export type NestBlockReason = "has-subtasks" | "repeating";

// Shared "is this task part of a repeat series" predicate — a task either
// defines its own repeat weekdays, or is an occurrence generated from
// another task's series (repeatSourceId). Note: checked against length, not
// `!== undefined` — some callers' buffered drafts always spread
// repeatWeekdays as an array (defaulting to []) for a non-routine task, so
// an emptiness check (not just definedness) is required to correctly
// detect non-routine tasks there too.
export function isRoutineTask(task: Task): boolean {
  return (task.repeatWeekdays?.length ?? 0) > 0 || task.repeatSourceId !== undefined;
}

// A Subtask can hold a title, done state, and memo (types.ts) — a task with
// its own subtasks, or one that's part of a repeat series (removing it has
// side effects on the rest of the series, not just data loss), can't be
// converted into a subtask at all.
export function nestBlockReasonFor(task: Task): NestBlockReason | undefined {
  if ((task.subtasks?.length ?? 0) > 0) return "has-subtasks";
  if (isRoutineTask(task)) return "repeating";
  return undefined;
}

export function nestBlockMessage(reason: NestBlockReason): string {
  return reason === "has-subtasks"
    ? "This task already has subtasks and can't be nested."
    : "Repeating tasks must be detached from their series first.";
}

// Fields a Subtask can't represent — anything here is silently dropped when
// a task is converted, so the caller must confirm with the user first.
export function lostFieldsFor(task: Task): string[] {
  const fields: string[] = [];
  if (task.completedAt) fields.push("completion time");
  if (task.time) fields.push("time");
  if (task.durationMinutes) fields.push("duration");
  if (task.priority) fields.push("priority");
  if (task.dueDate) fields.push("due date");
  if (task.background) fields.push("background");
  if (task.rolledFrom) fields.push("rollover history");
  if ((task.excludedDates?.length ?? 0) > 0) fields.push("excluded routine dates");
  return fields;
}
