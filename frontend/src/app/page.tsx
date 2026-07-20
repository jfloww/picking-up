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
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-[12vh] text-center">
          <h1 className="text-4xl font-extralight tracking-tight text-foreground sm:text-6xl">
            Everything you need to do.
            <br />
            Nothing else.
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            The calm home for your tasks.
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
        </section>

        <section className="mx-auto mt-14 w-full max-w-4xl px-6">
          <TaskMock />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
