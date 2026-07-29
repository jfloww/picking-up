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

export function monthGrid(monthKey: string): string[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const firstCell = addDays(`${monthKey}-01`, -firstWeekday);
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const rows: string[][] = [];
  for (let i = 0; i < totalCells; i += 7) {
    rows.push(Array.from({ length: 7 }, (_, j) => addDays(firstCell, i + j)));
  }
  return rows;
}

// A Sunday-start week counter: returns 1 for the week containing January 1st
// (of whichever year that week belongs to), then increments for each subsequent
// week. Handles year boundaries correctly — e.g., a date like Dec 28 that starts
// a week containing Jan 1 of the following year is counted as week 1 of that
// following year, not week 53 of its own calendar year. Not ISO 8601 (which uses
// Monday-start weeks and different year-boundary rules).
export function weekOfYear(dateKey: string): number {
  const weekStart = weekStartOf(dateKey);
  const year = parseInt(yearOf(dateKey));

  // Check if next year's Jan 1 falls in this week; if so, this is week 1 of the next year
  if (weekStartOf(`${year + 1}-01-01`) === weekStart) {
    return 1;
  }

  // weekStartOf is monotonic and dateKey is always within its own year, so
  // this week's start is always on-or-after this year's Jan 1 week-start
  // once the next-year check above has ruled out the one case where it isn't.
  const thisYearJan1WeekStart = weekStartOf(`${year}-01-01`);
  return Math.floor(daysBetween(thisYearJan1WeekStart, weekStart) / 7) + 1;
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

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parse(toKey).getTime() - parse(fromKey).getTime()) / 86_400_000);
}

export function isOverdue(dueDate: string, today: string): boolean {
  return dueDate < today;
}

export function dueDateLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return "Due Today";
  if (diff > 0 && diff <= 7) {
    const weekday = parse(dueDate).toLocaleDateString("en-US", { weekday: "short" });
    return `Due ${weekday}`;
  }
  const d = parse(dueDate);
  return `Due ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
}
