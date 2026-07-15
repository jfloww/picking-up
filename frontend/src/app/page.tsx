import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TaskMock } from "@/components/task-mock";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "rounded-full px-4",
            )}
          >
            Sign in
          </Link>
        </div>
      </header>

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
          </div>
        </section>

        <section className="mx-auto mt-14 w-full max-w-4xl px-6">
          <TaskMock />
        </section>
      </main>

      <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
        <Wordmark className="opacity-60" />
        <p className="text-xs text-muted-foreground">© 2026 Picking Up</p>
      </footer>
    </div>
  );
}
