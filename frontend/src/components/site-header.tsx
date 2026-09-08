import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { LogoutButton } from "@/features/auth/components/logout-button";
import type { CurrentUser } from "@/features/auth/types";
import { cn } from "@/lib/utils";

export function displayName(user: CurrentUser): string {
  const full = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || user.username || user.email;
}

export function SiteHeader({ user, compact = false }: { user: CurrentUser | null; compact?: boolean }) {
  return (
    <header className={cn("flex items-center justify-between px-6 py-5 sm:px-10", compact && "mx-auto h-14 w-full max-w-[1600px] shrink-0 py-2 sm:px-6")}>
      <Wordmark />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {user ? (
          <>
            <span className="text-sm text-muted-foreground">
              {displayName(user)}
            </span>
            <LogoutButton />
          </>
        ) : (
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "rounded-full px-4",
            )}
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
