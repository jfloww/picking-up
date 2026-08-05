import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("renders the P mark with a theme-aware stroke color, not a fixed light color", () => {
    // The mark used to be a static PNG baked with an ivory/near-white "P",
    // which disappeared against a light-mode background (#ffffff). The "P"
    // stroke must track currentColor (inherits text-foreground, which is
    // theme-aware) so it stays visible in both themes.
    render(<Wordmark />);
    const mark = screen.getByRole("img", { name: "P" });
    const pPath = mark.querySelector("path");
    expect(pPath?.getAttribute("stroke")).toBe("currentColor");
  });

  it("still links to the home page", () => {
    render(<Wordmark />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
  });
});
