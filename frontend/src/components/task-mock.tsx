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
      <div className="border-b border-border px-6 py-4 sm:px-8 sm:py-6">
        <p className="text-xl font-bold tracking-tight text-foreground">Tuesday, March 10</p>
      </div>
      <div className="border-b border-border px-6 py-4 sm:px-8 sm:py-5">
        <div className="border-l-2 border-brand pl-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-brand uppercase">
              Current Focus
            </span>
            <span className="rounded-full border border-border px-2 text-[11px] font-medium text-subtle">
              1 of 3
            </span>
          </div>
          <div className="mt-0.5 sm:flex sm:items-baseline sm:gap-3">
            <span className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
              Ship the client portal
            </span>
            <span className="hidden text-xs text-muted-foreground sm:block">
              Everything that moves the March launch forward.
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row">
        <div className="flex-[3] space-y-4 border-b border-border p-4 sm:border-r sm:border-b-0 sm:p-6 lg:p-8">
          {timelineBlocks.map((block) => (
            <div
              key={block.title}
              className={cn(
                "rounded-r-lg border-l-2 px-3 py-2 sm:px-4 sm:py-3",
                block.accent === "brand"
                  ? "border-l-brand bg-brand/10"
                  : "border-l-muted-foreground bg-muted/40",
              )}
            >
              <span className="block text-xs tabular-nums text-muted-foreground">
                {block.time}
              </span>
              <span className="text-xs font-medium text-foreground sm:text-sm">
                {block.title}
              </span>
            </div>
          ))}
        </div>
        <div className="flex-[2] p-4 sm:p-6 lg:p-8">
          <section>
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              All Day To-Do
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-3 py-2 sm:px-4 sm:py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-border" />
              <span className="truncate text-xs text-foreground sm:text-sm">Grocery pickup</span>
            </div>
          </section>
          <section className="mt-6">
            <span className="text-xs font-semibold tracking-wider text-subtle uppercase">
              Next Up
            </span>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-3 py-2 sm:px-4 sm:py-3">
              <span className="size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="truncate text-xs text-foreground sm:text-sm">
                Finalize API notes
              </span>
            </div>
            <div className="animate-hero-demo-row mt-2 flex items-center gap-3 rounded-lg bg-muted ring-1 ring-border px-3 py-2 sm:px-4 sm:py-3">
              <span className="animate-hero-demo-dot size-4 shrink-0 rounded-[5px] border-2 border-brand" />
              <span className="animate-hero-demo-title truncate text-xs text-foreground sm:text-sm">
                Prep client agenda
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
