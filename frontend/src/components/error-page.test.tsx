import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

import { ErrorPage } from "./error-page";

function stubRouter() {
  const back = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ back } as unknown as ReturnType<typeof useRouter>);
  return back;
}

describe("ErrorPage", () => {
  it("shows the given title and description", () => {
    stubRouter();
    render(<ErrorPage title="Page not found" description="It went missing." />);

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("It went missing.")).toBeTruthy();
  });

  it("Go back calls the router's back()", () => {
    const back = stubRouter();
    render(<ErrorPage title="Oops" description="Something broke." />);

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(back).toHaveBeenCalledOnce();
  });

  it("Go to home links to /", () => {
    stubRouter();
    render(<ErrorPage title="Oops" description="Something broke." />);

    const homeLink = screen.getByRole("link", { name: "Go to home" });
    expect(homeLink.getAttribute("href")).toBe("/");
  });

  it("omits Try again when no onRetry is given", () => {
    stubRouter();
    render(<ErrorPage title="Page not found" description="It went missing." />);

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("Try again calls onRetry when one is given", () => {
    stubRouter();
    const onRetry = vi.fn();
    render(<ErrorPage title="Oops" description="Something broke." onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
