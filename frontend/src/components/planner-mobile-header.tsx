"use client";

import { Home, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/features/auth/components/logout-button";
import type { CurrentUser } from "@/features/auth/types";
import {
  useFocusTrap,
  useRestoreFocusOnUnmount,
} from "@/features/tasks/components/use-focus-trap";

import { displayName } from "./site-header";

function ProfileSheet({ user, onClose }: { user: CurrentUser | null; onClose: () => void }) {
  const sheetRef = useRef<HTMLElement>(null);

  useFocusTrap(sheetRef, true);
  useRestoreFocusOnUnmount(sheetRef);

  return (
    <>
      <button
        type="button"
        aria-label="Close profile and appearance menu"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px]"
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Profile and appearance"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
              Account
            </p>
            <p className="truncate text-sm font-medium">
              {user ? displayName(user) : "Not signed in"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex min-h-14 items-center justify-between border-b border-border py-2">
          <span className="text-sm font-medium">Appearance</span>
          <ThemeToggle />
        </div>
        <Link
          href="/"
          onClick={onClose}
          className="flex min-h-14 items-center gap-3 border-b border-border text-sm font-medium"
        >
          <Home className="size-4 text-muted-foreground" />
          Home
        </Link>
        <div className="flex min-h-14 items-center justify-end pt-3">
          {user ? (
            <LogoutButton />
          ) : (
            <Link
              href="/login"
              className="flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium"
            >
              Sign in
            </Link>
          )}
        </div>
      </section>
    </>
  );
}

export function PlannerMobileHeader({ user }: { user: CurrentUser | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="relative z-30 flex min-h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)] sm:hidden">
      <Link
        href="/"
        aria-label="Picking Up home"
        className="text-[15px] font-extrabold tracking-[0.16em] text-foreground"
      >
        PICKING <span className="text-wordmark">UP</span>
      </Link>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open profile and appearance menu"
        aria-expanded={open}
        className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <MoreHorizontal className="size-5" />
      </button>

      {open && <ProfileSheet user={user} onClose={() => setOpen(false)} />}
    </header>
  );
}
