import type { Scope, Subtask, Task } from "../types";

type ScopeKind = Scope["kind"];

export interface ApiTask {
  id: string;
  title: string;
  memo: string | null;
  done: boolean;
  scope_kind: ScopeKind;
  scope_value: string;
  rolled_from_kind: ScopeKind | null;
  rolled_from_value: string | null;
  created_at: string;
  completed_at: string | null;
  time: string | null;
  due_date: string | null;
  subtasks: Subtask[];
  repeat_weekdays: number[] | null;
  repeat_source: string | null;
  excluded_dates: string[] | null;
  priority: boolean | null;
  duration_minutes: number | null;
  background: boolean | null;
}

function scopeValueOf(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return scope.date;
    case "week":
      return scope.weekStart;
    case "month":
      return scope.month;
    case "year":
      return scope.year;
  }
}

function scopeFromParts(kind: ScopeKind, value: string): Scope {
  switch (kind) {
    case "day":
      return { kind: "day", date: value };
    case "week":
      return { kind: "week", weekStart: value };
    case "month":
      return { kind: "month", month: value };
    case "year":
      return { kind: "year", year: value };
  }
}

export function toApiPayload(task: Task): ApiTask {
  return {
    id: task.id,
    title: task.title,
    memo: task.memo ?? null,
    done: task.done,
    scope_kind: task.scope.kind,
    scope_value: scopeValueOf(task.scope),
    rolled_from_kind: task.rolledFrom?.kind ?? null,
    rolled_from_value: task.rolledFrom ? scopeValueOf(task.rolledFrom) : null,
    created_at: task.createdAt,
    completed_at: task.completedAt ?? null,
    time: task.time ?? null,
    due_date: task.dueDate ?? null,
    subtasks: task.subtasks ?? [],
    repeat_weekdays: task.repeatWeekdays ?? null,
    repeat_source: task.repeatSourceId ?? null,
    excluded_dates: task.excludedDates ?? null,
    priority: task.priority ?? null,
    duration_minutes: task.durationMinutes ?? null,
    background: task.background ?? null,
  };
}

export function fromApiPayload(payload: ApiTask): Task {
  return {
    id: payload.id,
    title: payload.title,
    memo: payload.memo ?? undefined,
    done: payload.done,
    scope: scopeFromParts(payload.scope_kind, payload.scope_value),
    rolledFrom:
      payload.rolled_from_kind && payload.rolled_from_value
        ? scopeFromParts(payload.rolled_from_kind, payload.rolled_from_value)
        : undefined,
    createdAt: payload.created_at,
    completedAt: payload.completed_at ?? undefined,
    time: payload.time ?? undefined,
    subtasks: payload.subtasks.length > 0 ? payload.subtasks : undefined,
    repeatWeekdays: payload.repeat_weekdays ?? undefined,
    repeatSourceId: payload.repeat_source ?? undefined,
    excludedDates: payload.excluded_dates ?? undefined,
    priority: payload.priority ?? undefined,
    durationMinutes: payload.duration_minutes ?? undefined,
    background: payload.background ?? undefined,
    dueDate: payload.due_date ?? undefined,
  };
}
