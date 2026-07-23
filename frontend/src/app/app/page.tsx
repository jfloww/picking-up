import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUserOrNull } from "@/features/auth/api/auth";
import { TaskCalendar } from "@/features/tasks/components/task-calendar";

export default async function AppPage() {
  const user = await getCurrentUserOrNull();

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <SiteHeader user={user} />

      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-6 py-6">
        <TaskCalendar />
      </main>

      <SiteFooter />
    </div>
  );
}
