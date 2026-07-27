"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { STORAGE_KEY } from "@/features/tasks/data/repository";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);
    // Legacy local tasks are scoped to nobody in particular; leaving them
    // behind would let the next account to sign in on this browser migrate
    // the previous user's tasks into their own account.
    localStorage.removeItem(STORAGE_KEY);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleLogout} type="button">
      {isPending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
