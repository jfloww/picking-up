import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TaskMock } from "@/components/task-mock";
import { getCurrentUserOrNull } from "@/features/auth/api/auth";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const user = await getCurrentUserOrNull();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader user={user} />

      <main className="flex flex-1 flex-col">
        <section className="mx-auto w-full max-w-[1200px] px-6 pb-24 pt-[10vh] lg:pt-[14vh]">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h1 className="animate-fade-up text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Pick up your day.
            </h1>
            <p className="animate-fade-up mt-5 max-w-md text-base text-muted-foreground [animation-delay:120ms] sm:text-lg">
              Turn your to-dos into a clear plan — one day at a time, one week in view.
            </p>
            <div className="animate-fade-up mt-8 flex gap-3 [animation-delay:240ms]">
              {user ? (
                <Link
                  href="/planner"
                  className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}
                >
                  Open app
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}
                  >
                    Get started
                  </Link>
                  <Link
                    href="/login"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "rounded-full px-6",
                    )}
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="animate-fade-up mt-16 [animation-delay:400ms]">
            <TaskMock />
          </div>

          <div className="mt-24 flex flex-col gap-10 border-t border-border pt-12 sm:flex-row sm:gap-0">
            <div className="flex-1 sm:pr-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Focus your day
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Turn tasks into a clear timeline and actionable agenda.
              </p>
            </div>
            <div className="flex-1 sm:border-l sm:border-border sm:px-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                See your week clearly
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Understand your workload across the week at a glance.
              </p>
            </div>
            <div className="flex-1 sm:border-l sm:border-border sm:pl-8">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Keep routines flexible
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Repeat what matters and adjust one occurrence without breaking the whole series.
              </p>
            </div>
          </div>

          <p className="mt-10 text-center text-xs text-subtle">
            Your tasks stay synced across devices.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
