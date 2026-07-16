import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PeriodCell({
  focused,
  onFocus,
  label,
  className,
  contentClassName,
  children,
  "aria-label": ariaLabel,
}: {
  focused: boolean;
  onFocus?: () => void;
  label?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
  "aria-label"?: string;
}) {
  const content = (
    <>
      {label && <div className="mb-1 text-xs font-semibold">{label}</div>}
      <div className={cn(contentClassName, !focused && "pointer-events-none")}>
        {children}
      </div>
    </>
  );

  if (focused) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn("rounded-md bg-card ring-1 ring-ring/40", className)}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      role={onFocus ? "button" : undefined}
      tabIndex={onFocus ? 0 : undefined}
      onClick={onFocus}
      onKeyDown={
        onFocus
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocus();
              }
            }
          : undefined
      }
      className={cn(
        "rounded-md opacity-50 transition-opacity",
        onFocus &&
          "cursor-pointer hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {content}
    </div>
  );
}
