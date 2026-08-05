import type { Task } from "../types";

export type NestBlockReason = "has-subtasks" | "repeating";

// A Subtask can only hold a title and done state (types.ts) — a task with
// its own subtasks, or one that's part of a repeat series (removing it has
// side effects on the rest of the series, not just data loss), can't be
// converted into a subtask at all.
export function nestBlockReasonFor(task: Task): NestBlockReason | undefined {
  if ((task.subtasks?.length ?? 0) > 0) return "has-subtasks";
  if ((task.repeatWeekdays?.length ?? 0) > 0 || task.repeatSourceId !== undefined) return "repeating";
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
  if (task.memo) fields.push("note");
  if (task.time) fields.push("time");
  if (task.durationMinutes) fields.push("duration");
  if (task.priority) fields.push("priority");
  if (task.dueDate) fields.push("due date");
  if (task.background) fields.push("background");
  return fields;
}
