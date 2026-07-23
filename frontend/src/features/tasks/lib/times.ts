import type { Task } from "../types";
import { DAY_LABELS, weekDates, weekStartOf } from "./dates";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function nowTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function compareTasksForDay(a: Task, b: Task): number {
  if (a.time && b.time) {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  }
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}

export function yToSnappedTime(
  y: number,
  hourHeight: number,
  snapMinutes = 15,
): string {
  const totalMinutes = (y / hourHeight) * 60;
  const snapped = Math.round(totalMinutes / snapMinutes) * snapMinutes;
  const clamped = Math.min(Math.max(snapped, 0), 23 * 60 + 45);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface TimedTaskLayout {
  task: Task;
  column: number;
  columns: number;
}

export function layoutTimedTasks(timed: Task[]): TimedTaskLayout[] {
  const groups = new Map<string, Task[]>();
  for (const task of timed) {
    const key = task.time!;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }

  return timed.map((task) => {
    const group = groups.get(task.time!)!;
    return { task, column: group.indexOf(task), columns: group.length };
  });
}

export interface WeeklyRollupItem {
  task: Task;
  date: string | null;
}

export function weeklyRollupTasks(tasks: Task[], weekStart: string): WeeklyRollupItem[] {
  const items: WeeklyRollupItem[] = [];

  for (const task of tasks) {
    if (task.scope.kind === "week" && task.scope.weekStart === weekStart) {
      const date = task.rolledFrom?.kind === "day" ? task.rolledFrom.date : null;
      items.push({ task, date });
    } else if (
      task.scope.kind === "day" &&
      !task.done &&
      weekStartOf(task.scope.date) === weekStart
    ) {
      items.push({ task, date: task.scope.date });
    }
  }

  return items.sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return compareTasksForDay(a.task, b.task);
    }
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}

export function repeatCadenceLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7) return "Daily";
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Weekdays";
  return sorted.map((d) => DAY_LABELS[d]).join("/");
}

export function resolveRepeatWeekdays(task: Task, tasks: Task[]): number[] | undefined {
  if (task.repeatWeekdays && task.repeatWeekdays.length > 0) {
    return task.repeatWeekdays;
  }
  if (task.repeatSourceId) {
    const anchor = tasks.find((t) => t.id === task.repeatSourceId);
    if (anchor?.repeatWeekdays && anchor.repeatWeekdays.length > 0) {
      return anchor.repeatWeekdays;
    }
  }
  return undefined;
}

export function repeatLabelForTask(task: Task, tasks: Task[]): string | undefined {
  const weekdays = resolveRepeatWeekdays(task, tasks);
  return weekdays && repeatCadenceLabel(weekdays);
}

export interface WeekStats {
  done: number;
  total: number;
}

export function weekStats(tasks: Task[], weekStart: string): WeekStats {
  const dates = new Set(weekDates(weekStart));
  const inWeek = tasks.filter((t) => {
    if (t.scope.kind === "day") return weekStartOf(t.scope.date) === weekStart;
    if (t.scope.kind !== "week" || t.scope.weekStart !== weekStart) return false;
    if (t.rolledFrom?.kind === "day") return dates.has(t.rolledFrom.date);
    return true;
  });
  return {
    total: inWeek.length,
    done: inWeek.filter((t) => t.done).length,
  };
}

export function dayTasksForWeek(
  tasks: Task[],
  date: string,
  weekStart: string,
): Task[] {
  return tasks.filter(
    (t) =>
      (t.scope.kind === "day" && t.scope.date === date) ||
      (t.scope.kind === "week" &&
        t.scope.weekStart === weekStart &&
        t.rolledFrom?.kind === "day" &&
        t.rolledFrom.date === date),
  );
}

export function isPastToday(
  time: string,
  date: string,
  today: string,
  nowTime: string,
): boolean {
  return date === today && time < nowTime;
}
