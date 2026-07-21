import type { ReactNode } from "react";

/**
 * Requires a definite-height ancestor (e.g. `h-full`/`h-svh` up the tree) —
 * `secondary`'s calc() cap and this component's own `h-full` don't resolve
 * against an auto-height parent, and the shrink/containment silently no-ops.
 * `primaryMinHeight` should be <= `primaryMaxHeight`.
 */
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
      {/* The explicit minHeight is what creates the floor. overflow-hidden
          clips primary content that doesn't self-scroll (the Daily rail
          happens to, but a future caller's content might not). */}
      <div
        data-testid="shrink-stack-primary"
        className="flex-1 overflow-hidden"
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
