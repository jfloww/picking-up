import { cn } from "@/lib/utils";

const navItems = ["Today", "Inbox", "Done"];

const rows = [
  { label: "Reply to the design review", done: true, active: false },
  { label: "Book dentist appointment", done: false, active: true },
  { label: "Prepare Monday standup notes", done: false, active: false },
  { label: "Pick up groceries", done: false, active: false },
];

export function TaskMock() {
  return (
    <div
      aria-hidden
      className="rounded-t-xl border border-b-0 border-border bg-card p-4 shadow-[0_-16px_64px_-24px_rgb(0_0_0/0.4)] sm:p-6"
    >
      <div className="flex gap-5">
        <div className="hidden w-40 shrink-0 flex-col gap-1 sm:flex">
          {navItems.map((item, index) => (
            <div
              key={item}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                index === 0
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {item}
            </div>
          ))}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
            >
              <span
                className={cn(
                  "size-4 shrink-0 rounded-full border",
                  row.done && "border-transparent bg-brand/40",
                  row.active && "border-brand",
                  !row.done && !row.active && "border-border",
                )}
              />
              <span
                className={cn(
                  "truncate text-sm",
                  row.done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
