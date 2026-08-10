import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PlannerLoading from "./loading";

describe("PlannerLoading", () => {
  it("shows a spinner and loading text", () => {
    render(<PlannerLoading />);
    expect(screen.getByText("Loading your planner…")).toBeTruthy();
  });
});
