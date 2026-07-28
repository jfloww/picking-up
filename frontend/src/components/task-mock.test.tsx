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

  it("no longer shows the old fabricated nav", () => {
    render(<TaskMock />);
    expect(screen.queryByText("Inbox")).toBeNull();
  });
});
