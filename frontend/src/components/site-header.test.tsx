import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { ThemeProvider } from "@/components/theme-provider";
import type { CurrentUser } from "@/features/auth/types";

import { displayName, SiteHeader } from "./site-header";

function renderHeader(user: CurrentUser | null) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SiteHeader user={user} />
    </ThemeProvider>,
  );
}

describe("displayName", () => {
  it("prefers the full name when present", () => {
    expect(
      displayName({
        id: 1,
        email: "j@example.com",
        first_name: "Jane",
        last_name: "Doe",
      }),
    ).toBe("Jane Doe");
  });

  it("falls back to username when no name is set", () => {
    expect(
      displayName({ id: 1, email: "j@example.com", username: "janedoe" }),
    ).toBe("janedoe");
  });

  it("falls back to email when neither name nor username is set", () => {
    expect(displayName({ id: 1, email: "j@example.com" })).toBe(
      "j@example.com",
    );
  });
});

describe("SiteHeader", () => {
  it("shows a Sign in link when logged out", () => {
    renderHeader(null);
    const signInLink = screen.getByRole("link", { name: "Sign in" });
    expect(signInLink.getAttribute("href")).toBe("/login");
    expect(screen.queryByText("Sign out")).toBeNull();
    expect(
      screen.getByRole("button", { name: /switch to (light|dark) mode/i }),
    ).toBeTruthy();
  });

  it("shows the display name and a Sign out button when logged in", () => {
    renderHeader({ id: 1, email: "jane@example.com", first_name: "Jane" });
    expect(screen.getByText("Jane")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /switch to (light|dark) mode/i }),
    ).toBeTruthy();
  });

  it("always renders the wordmark linking to /", () => {
    renderHeader(null);
    const wordmarkLink = screen.getByRole("link", { name: /picking\s+up/i });
    expect(wordmarkLink.getAttribute("href")).toBe("/");
  });
});
