import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("shows the copyright text and the wordmark linking to /", () => {
    render(<SiteFooter />);
    expect(screen.getByText("© 2026 Picking Up")).toBeTruthy();
    // Wordmark renders "PICKING" and "UP" joined by &nbsp; (U+00A0), which a
    // plain space in a regex won't match — \s+ does.
    const wordmarkLink = screen.getByRole("link", { name: /picking\s+up/i });
    expect(wordmarkLink.getAttribute("href")).toBe("/");
  });

  it("links to the GitHub profile, opening in a new tab", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: "GitHub profile" });
    expect(link.getAttribute("href")).toBe("https://github.com/jfloww");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
