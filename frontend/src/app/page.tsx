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
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 pt-[10vh] pb-16 lg:flex-row lg:items-center lg:pt-[14vh]">
          <div className="flex flex-col items-center text-center lg:flex-1 lg:items-start lg:text-left">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Pick up your day.
            </h1>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Plan what matters today, and see your whole week at a glance.
            </p>
            <div className="mt-8 flex gap-3">
              {user ? (
                <Link
                  href="/app"
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
          <div className="w-full lg:flex-[1.1]">
            <TaskMock />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
