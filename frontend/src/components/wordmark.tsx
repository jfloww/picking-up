import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center text-xs font-semibold tracking-[0.3em] text-foreground",
        className,
      )}
    >
      <Image
        src="/mark-transparent-512.png"
        alt="P"
        width={20}
        height={20}
        priority
      />
      ICKING&nbsp;<span className="text-wordmark">UP</span>
    </Link>
  );
}
