import type { Task } from "../types";

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
