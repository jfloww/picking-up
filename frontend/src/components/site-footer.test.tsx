import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SiteFooter } from "./site-footer";
import packageJson from "../../package.json";

describe("SiteFooter", () => {
  it("shows the copyright text and the wordmark linking to /", () => {
    render(<SiteFooter />);
    // The copyright text is now split by the version link, so search for just the
    // first part that's guaranteed to be visible as one node.
    expect(screen.getByText(/© 2026 JFLOWW/)).toBeTruthy();
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

  it("shows the package version, linking to /diagnostics", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: `v${packageJson.version}` });
    expect(link.getAttribute("href")).toBe("/diagnostics");
  });

  it("includes a short commit SHA in the link text when VERCEL_GIT_COMMIT_SHA is set", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a84c20fdeadbeef1234567890abcdef12345678");
    render(<SiteFooter />);
    expect(
      screen.getByRole("link", { name: `v${packageJson.version} (a84c20f)` }),
    ).toBeTruthy();
    vi.unstubAllEnvs();
  });
});
