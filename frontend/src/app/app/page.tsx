import { LogoutButton } from "@/features/auth/components/logout-button";
import { TaskCalendar } from "@/features/tasks/components/task-calendar";
import { Wordmark } from "@/components/wordmark";

export default function AppPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-6 py-6">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <LogoutButton />
      </header>
      <main className="mt-6">
        <TaskCalendar />
      </main>
    </div>
  );
}
