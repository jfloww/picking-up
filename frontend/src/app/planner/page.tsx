import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PlannerMobileHeader } from "@/components/planner-mobile-header";
import { getCurrentUserOrNull } from "@/features/auth/api/auth";
import { TaskCalendar } from "@/features/tasks/components/task-calendar";

export default async function PlannerPage() {
  const user = await getCurrentUserOrNull();

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <div className="hidden sm:block">
        <SiteHeader user={user} />
      </div>
      <PlannerMobileHeader user={user} />

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col sm:px-6 sm:py-6">
        <TaskCalendar />
      </main>

      <div className="hidden sm:block">
        <SiteFooter />
      </div>
    </div>
  );
}
