import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday; week 2026-07-12 .. 2026-07-18

describe("DailyView", () => {
  it("focuses the anchor day: quick-add only there and in the weekly cell", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <DailyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText("Add task")).toHaveLength(2),
    );
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Th 16")).toBeTruthy();
  });

  it("clicking a faded day refocuses it", async () => {
    const onAnchorChange = vi.fn();
    render(
      <TasksProvider repository={fakeRepository()}>
        <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Su 12" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Su 12" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-12");
  });
});
