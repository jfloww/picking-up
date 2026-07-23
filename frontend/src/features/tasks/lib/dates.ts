export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parse(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(dateKey: string, n: number): string {
  const d = parse(dateKey);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8));
}

export function weekStartOf(dateKey: string): string {
  return addDays(dateKey, -parse(dateKey).getDay());
}

export function weekdayOf(dateKey: string): number {
  return parse(dateKey).getDay();
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function yearOf(dateKey: string): string {
  return dateKey.slice(0, 4);
}

export function nextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthKeys(year: string): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
}

export function monthGrid(monthKey: string): (string | null)[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = Array(new Date(y, m - 1, 1).getDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    row.push(toKey(new Date(y, m - 1, day)));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    rows.push([...row, ...Array(7 - row.length).fill(null)]);
  }
  return rows;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function monthName(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

export function dayLabel(dateKey: string): string {
  return parse(dateKey).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function shortDateLabel(dateKey: string, today: string): string {
  if (dateKey === today) return "Today";
  const d = parse(dateKey);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${month} ${d.getDate()}`;
}

export function upcomingRepeatDates(
  weekdays: number[],
  from: string,
  count: number,
): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (dates.length < count && weekdays.length > 0) {
    if (weekdays.includes(weekdayOf(cursor))) {
      dates.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function weekRangeLabel(weekStart: string): string {
  const start = parse(weekStart);
  const end = parse(addDays(weekStart, 6));
  const fmt = (d: Date) =>
    `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}
