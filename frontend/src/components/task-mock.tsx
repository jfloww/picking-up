import { cn } from "@/lib/utils";

const timelineBlocks: { time: string; title: string; accent: "brand" | "muted" }[] = [
  { time: "9:30 – 10:15", title: "Design review reply", accent: "brand" },
  { time: "1:00 – 1:45", title: "Book dentist appointment", accent: "muted" },
  { time: "2:30 – 3:00", title: "Standup notes", accent: "muted" },
];

export function TaskMock() {
  return (
    <div
      aria-hidden
      className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
    >
      <div className="border-b border-border px-8 py-6">
        <p className="text-xl font-bold tracking-tight text-foreground">Tuesday, March 10</p>
      </div>
      <div className="flex">
        <div className="flex-[3] space-y-4 border-r border-border p-8">
          {timelineBlocks.map((block) => (
            <div
              key={block.title}
              className={cn(
                "rounded-r-lg border-l-2 px-4 py-3",
                block.accent === "brand"
                  ? "border-l-brand bg-brand/10"
                  : "border-l-muted-foreground bg-muted/40",
              )}
            >
              <span className="block text-xs tabular-nums text-muted-foreground">
                {block.time}
              </span>
              <span className="text-sm font-medium text-foreground">{block.title}</span>
            </div>
          ))}
        </div>
        <div className="flex-[2] p-8">
          <section>
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              All Day To-Do
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-border" />
              <span className="truncate text-sm text-foreground">Grocery pickup</span>
            </div>
          </section>
          <section className="mt-6">
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              Next Up
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="truncate text-sm text-foreground">Finalize API notes</span>
            </div>
            <div className="animate-hero-demo-row mt-2 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-4 py-3">
              <span className="animate-hero-demo-dot size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="animate-hero-demo-title truncate text-sm text-foreground">
                Prep client agenda
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
