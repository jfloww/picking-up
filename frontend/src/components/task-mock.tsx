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
      className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">
          Tuesday, March 10
        </h2>
      </div>
      <div className="flex">
        <div className="flex-[3] space-y-3 border-r border-border p-4">
          {timelineBlocks.map((block) => (
            <div
              key={block.title}
              className={cn(
                "rounded-r-md border-l-2 px-2.5 py-1.5",
                block.accent === "brand"
                  ? "border-l-brand bg-brand/10"
                  : "border-l-muted-foreground bg-muted/40",
              )}
            >
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {block.time}
              </span>
              <span className="text-[11px] font-medium text-foreground">{block.title}</span>
            </div>
          ))}
        </div>
        <div className="flex-[2] p-4">
          <section>
            <h3 className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
              All Day To-Do
            </h3>
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="size-3.5 shrink-0 rounded-[4px] border-2 border-border" />
              <span className="truncate text-[11px] text-foreground">Grocery pickup</span>
            </div>
          </section>
          <section className="mt-4">
            <h3 className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
              Next Up
            </h3>
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="size-3.5 shrink-0 rounded-[4px] border-2 border-brand" />
              <span className="truncate text-[11px] text-foreground">Finalize API notes</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
