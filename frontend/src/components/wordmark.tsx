import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 text-xs font-semibold tracking-[0.3em] text-foreground",
        className,
      )}
    >
      <Image src="/mark-transparent-512.png" alt="" width={20} height={20} priority />
      PICKING&nbsp;<span className="text-wordmark">UP</span>
    </Link>
  );
}
