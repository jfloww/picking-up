import { describe, expect, it } from "vitest";

import { computeOrderBetween } from "./reorder";

describe("computeOrderBetween", () => {
  it("returns 0 when there are no neighbors (first task in an empty list)", () => {
    expect(computeOrderBetween(undefined, undefined)).toBe(0);
  });

  it("returns a value less than the only neighbor when dropped at the top edge", () => {
    expect(computeOrderBetween(undefined, 5)).toBeLessThan(5);
  });

  it("returns a value greater than the only neighbor when dropped at the bottom edge", () => {
    expect(computeOrderBetween(5, undefined)).toBeGreaterThan(5);
  });

  it("returns the midpoint when dropped between two neighbors", () => {
    expect(computeOrderBetween(2, 6)).toBe(4);
  });
});
