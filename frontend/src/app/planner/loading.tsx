import { Loader2 } from "lucide-react";

export default function PlannerLoading() {
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading your planner…</p>
    </div>
  );
}
