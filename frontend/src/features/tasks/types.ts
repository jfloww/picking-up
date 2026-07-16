export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string };

export interface Task {
  id: string;
  title: string;
  memo?: string;
  done: boolean;
  scope: Scope;
  rolledFrom?: Scope;
  createdAt: string;
  completedAt?: string;
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
