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

export function addMinutesToTime(time: string, minutes: number): string {
  const total = ((timeToMinutes(time) + minutes) % 1440 + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

// Tasks with a time but no explicit duration still need an end point to
// check overlap against — this is a layout-only footprint, never persisted.
const NOMINAL_DURATION_MINUTES = 30;

interface TimedInterval {
  start: number;
  end: number;
  task: Task;
}

// Assigns side-by-side columns to overlapping tasks so none render on top
// of each other: sort by start time, group into clusters of mutually
// touching intervals, then within each cluster greedily place each task in
// the first column whose previous occupant has already ended. Greedy
// first-fit by start time is optimal for interval graphs — the column
// count it produces equals the maximum number of tasks overlapping at any
// instant in that cluster, no more.
export function layoutTimedTasks(timed: Task[]): TimedTaskLayout[] {
  const intervals: TimedInterval[] = timed
    .map((task) => {
      const start = timeToMinutes(task.time!);
      const end = start + (task.durationMinutes ?? NOMINAL_DURATION_MINUTES);
      return { start, end, task };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: TimedTaskLayout[] = [];
  let cluster: TimedInterval[] = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const columnOf = new Map<TimedInterval, number>();
    for (const interval of cluster) {
      let column = columnEnds.findIndex((end) => end <= interval.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(interval.end);
      } else {
        columnEnds[column] = interval.end;
      }
      columnOf.set(interval, column);
    }
    const columns = columnEnds.length;
    for (const interval of cluster) {
      result.push({ task: interval.task, column: columnOf.get(interval)!, columns });
    }
    cluster = [];
  };

  for (const interval of intervals) {
    if (cluster.length > 0 && interval.start >= clusterEnd) {
      flushCluster();
      clusterEnd = -Infinity;
    }
    cluster.push(interval);
    clusterEnd = Math.max(clusterEnd, interval.end);
  }
  flushCluster();

  return result;
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

export function monthStats(tasks: Task[], monthKey: string): WeekStats {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let total = 0;
  let done = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    for (const t of dayTasksForWeek(tasks, date, weekStartOf(date))) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  for (const t of tasks) {
    if (t.scope.kind === "month" && t.scope.month === monthKey) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  return { total, done };
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
