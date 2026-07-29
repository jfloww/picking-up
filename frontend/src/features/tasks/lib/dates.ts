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

// A simple sequential count of Sunday-starting weeks since January 1st of
// dateKey's year — not strict ISO 8601 week numbering (which starts weeks
// on Monday and has its own year-boundary rules this app doesn't otherwise
// follow), matching this app's existing Sunday-start convention.
export function weekOfYear(dateKey: string): number {
  const weekStart = weekStartOf(dateKey);
  const year = parseInt(yearOf(dateKey));

  // Check if current year's Jan 1 is in this week
  let targetJan1 = `${year}-01-01`;
  if (weekStartOf(targetJan1) === weekStart) {
    return 1;
  }

  // Check if next year's Jan 1 is in this week
  targetJan1 = `${year + 1}-01-01`;
  if (weekStartOf(targetJan1) === weekStart) {
    return 1;
  }

  // Check if previous year's Jan 1 is in this week
  targetJan1 = `${year - 1}-01-01`;
  if (weekStartOf(targetJan1) === weekStart) {
    return 1;
  }

  // None of the above, use the most recent January 1st
  targetJan1 = `${year}-01-01`;
  const targetJan1WeekStart = weekStartOf(targetJan1);
  if (weekStart < targetJan1WeekStart) {
    // Use previous year
    targetJan1 = `${year - 1}-01-01`;
  }

  return Math.floor(daysBetween(weekStartOf(targetJan1), weekStart) / 7) + 1;
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
