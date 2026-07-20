import type { Task } from "../types";
import { weekStartOf } from "./dates";

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
