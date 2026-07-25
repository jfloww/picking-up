# Shared Layouts

## `frontend/src/app/layout.tsx`

Root App Router layout. Loads global CSS and Geist, then applies the dark-first theme provider to every route.

```tsx
import type { Metadata } from "next";

import "./globals.css";
import { Geist } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Picking Up",
  description: "A practical task workspace for web first and iPhone later.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

## `frontend/src/components/site-header.tsx`

Shared site and application header with wordmark, theme toggle, and authentication actions.

```tsx
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

export function SiteHeader({ user }: { user: CurrentUser | null }) {
  return (
    <header className="flex items-center justify-between px-6 py-5 sm:px-10">
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
```

## `frontend/src/components/site-footer.tsx`

Shared footer with wordmark, copyright, and GitHub link.

```tsx
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export function SiteFooter() {
  return (
    <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
      <Wordmark className="opacity-60" />
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">© 2026 Picking Up</p>
        <a
          href="https://github.com/jfloww"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub profile"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "rounded-full",
          )}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
```

## `frontend/src/components/auth-layout.tsx`

Centered authentication shell used by login and signup routes.

```tsx
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pt-[10vh] pb-16">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
    </div>
  );
}
```

## `frontend/src/components/wordmark.tsx`

Reusable brand link used in headers and footer.

```tsx
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "text-xs font-semibold tracking-[0.3em] text-foreground",
        className,
      )}
    >
      PICKING&nbsp;<span className="text-brand">UP</span>
    </Link>
  );
}
```

## `frontend/src/components/theme-toggle.tsx`

Shared light/dark theme action.

```tsx
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-hidden
        tabIndex={-1}
        disabled
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
```

## `frontend/src/components/theme-provider.tsx`

Thin shared wrapper over `next-themes`.

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(
  props: React.ComponentProps<typeof NextThemesProvider>,
) {
  return <NextThemesProvider {...props} />;
}
```
