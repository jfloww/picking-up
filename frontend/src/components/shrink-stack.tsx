import type { ReactNode } from "react";

type ShrinkStackProps = {
  primary: ReactNode;
  primaryMinHeight: number;
  primaryMaxHeight: number;
  secondary: ReactNode;
  gap?: number;
};

export function ShrinkStack({
  primary,
  primaryMinHeight,
  primaryMaxHeight,
  secondary,
  gap = 6,
}: ShrinkStackProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ gap }}>
      {/* overflow-hidden makes the flex auto-minimum-size algorithm honor
          minHeight as a real floor instead of growing to fit tall content */}
      <div
        data-testid="shrink-stack-primary"
        className="min-h-0 flex-1 overflow-hidden"
        style={{ minHeight: primaryMinHeight, maxHeight: primaryMaxHeight }}
      >
        {primary}
      </div>
      <div
        data-testid="shrink-stack-secondary"
        className="shrink-0 overflow-hidden"
        style={{ maxHeight: `calc(100% - ${primaryMinHeight}px - ${gap}px)` }}
      >
        {secondary}
      </div>
    </div>
  );
}
