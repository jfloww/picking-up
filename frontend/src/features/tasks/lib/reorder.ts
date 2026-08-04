// Fractional ordering: a drag only ever changes the single dragged task's
// order to a value between its new neighbors, so exactly one task updates
// per reorder instead of renumbering the whole list. `before`/`after` are
// the order values of the tasks immediately above/below the drop position
// (undefined at either edge of the list).
const EDGE_GAP = 1;

export function computeOrderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - EDGE_GAP;
  if (after === undefined) return before + EDGE_GAP;
  return (before + after) / 2;
}
