export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string };

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  memo?: string;
  done: boolean;
  scope: Scope;
  rolledFrom?: Scope;
  createdAt: string;
  completedAt?: string;
  time?: string; // "HH:MM", 24h zero-padded; meaningful on day-scoped tasks
  subtasks?: Subtask[]; // one level deep; no scope/memo/time of their own
  repeatWeekdays?: number[]; // 0=Sun..6=Sat; set only on the anchor task
  repeatSourceId?: string;   // set only on a task generated from an anchor
  excludedDates?: string[];  // day-scope dates ("YYYY-MM-DD") the anchor should not spawn for; set only on the anchor task
  priority?: boolean;
  durationMinutes?: number; // meaningful alongside `time`; a positive integer
  background?: boolean; // renders in the timeline's slim background lane instead of the regular overlap columns
  dueDate?: string; // "YYYY-MM-DD"; independent of scope; unset for routine tasks
}

export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return `day:${scope.date}`;
    case "week":
      return `week:${scope.weekStart}`;
    case "month":
      return `month:${scope.month}`;
    case "year":
      return `year:${scope.year}`;
  }
}
