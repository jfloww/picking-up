"use client";

import { useId } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  const gradientId = useId();

  return (
    <Link
      href="/"
      className={cn(
        "flex items-center text-xs font-semibold tracking-[0.3em] text-foreground",
        className,
      )}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 1024 1024"
        role="img"
        aria-label="P"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#5aa1e9" />
            <stop offset="1" stopColor="#68b4f8" />
          </linearGradient>
        </defs>
        {/* currentColor tracks text-foreground (theme-aware), unlike the
            original PNG's fixed ivory color, which disappeared against a
            light-mode background. */}
        <path
          d="M350 737V286Q350 245 391 245H565C704 245 770 326 770 424C770 524 704 594 565 594H522L390 730"
          fill="none"
          stroke="currentColor"
          strokeWidth={84}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M346 751L418 823L558 670"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={80}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      ICKING&nbsp;<span className="text-wordmark">UP</span>
    </Link>
  );
}
