import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskMock } from "./task-mock";

describe("TaskMock", () => {
  it("renders the real Daily view section labels", () => {
    render(<TaskMock />);
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.getByText("Next Up")).toBeTruthy();
  });

  it("shows realistic task titles and time ranges, not unlabeled bars", () => {
    render(<TaskMock />);
    expect(screen.getByText("Design review reply")).toBeTruthy();
    expect(screen.getByText("9:30 – 10:15")).toBeTruthy();
  });

  it("shows the current focus strip that sits above every real planner view", () => {
    render(<TaskMock />);
    expect(screen.getByText("Current Focus")).toBeTruthy();
    expect(screen.getByText("Ship the client portal")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("no longer shows the old fabricated nav", () => {
    render(<TaskMock />);
    expect(screen.queryByText("Inbox")).toBeNull();
  });

  it("is aria-hidden, since it is decorative", () => {
    const { container } = render(<TaskMock />);
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
    expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("includes a demo task wired to the CSS completion-loop animation classes", () => {
    render(<TaskMock />);
    const title = screen.getByText("Prep client agenda");
    expect(title.className).toContain("animate-hero-demo-title");
    const row = title.closest("div");
    expect(row?.className).toContain("animate-hero-demo-row");
    const dot = row?.querySelector("span:first-child");
    expect(dot?.className).toContain("animate-hero-demo-dot");
  });
});
