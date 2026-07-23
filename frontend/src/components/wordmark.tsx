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
      PICKING&nbsp;<span className="text-wordmark">UP</span>
    </Link>
  );
}
