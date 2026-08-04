import type { Category, Scope, Subtask, Task } from "../types";

type ScopeKind = Scope["kind"];

export interface ApiTask {
  id: string;
  title: string;
  memo: string | null;
  done: boolean;
  scope_kind: ScopeKind;
  scope_value: string;
  bucket_category: string | null;
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
  order: number;
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
    case "bucket":
      // Unused on the wire for bucket scope — bucket_category is the real
      // reference. Kept as "" (not e.g. the category id) so scope_value
      // never silently duplicates identity that could drift from the FK.
      return "";
  }
}

function scopeFromParts(kind: ScopeKind, value: string, bucketCategoryId: string | null): Scope {
  switch (kind) {
    case "day":
      return { kind: "day", date: value };
    case "week":
      return { kind: "week", weekStart: value };
    case "month":
      return { kind: "month", month: value };
    case "year":
      return { kind: "year", year: value };
    case "bucket":
      // rolled_from_kind/rolled_from_value can theoretically be "bucket" per
      // the type system, but nothing in this app ever rolls a bucket-scoped
      // task over (rollover.ts only handles day/week/month) — unreachable
      // in practice, so there's no rolled_from_bucket_category wire field to
      // read here; bucketCategoryId is always null on that call path.
      return { kind: "bucket", categoryId: bucketCategoryId ?? "" };
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
    bucket_category: task.scope.kind === "bucket" ? task.scope.categoryId : null,
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
    order: task.order,
  };
}

export function fromApiPayload(payload: ApiTask): Task {
  return {
    id: payload.id,
    title: payload.title,
    memo: payload.memo ?? undefined,
    done: payload.done,
    scope: scopeFromParts(payload.scope_kind, payload.scope_value, payload.bucket_category),
    rolledFrom:
      payload.rolled_from_kind && payload.rolled_from_value
        ? scopeFromParts(payload.rolled_from_kind, payload.rolled_from_value, null)
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
    order: payload.order,
  };
}

export interface ApiCategory {
  id: string;
  name: string;
  created_at: string;
}

export function categoryFromApiPayload(payload: ApiCategory): Category {
  return { id: payload.id, name: payload.name, createdAt: payload.created_at };
}
