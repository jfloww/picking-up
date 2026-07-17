import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
});
afterAll(() => {
  vi.useRealTimers();
});

function renderView(onAnchorChange = vi.fn()) {
  render(
    <TasksProvider repository={fakeRepository()}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("DailyView v2", () => {
  it("renders the day heading and a centered rolling window Mo 13 .. Su 19", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
    );
    // neighbors are faded buttons; the focused day is not a button
    const neighbors = screen.getAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ });
    expect(neighbors.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Mo 13",
      "Tu 14",
      "We 15",
      "Fr 17",
      "Sa 18",
      "Su 19",
    ]);
    expect(screen.getByText("Th 16")).toBeTruthy();
  });

  it("the focused center holds the timeline; the Weekly cell is editable", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("Weekly")).toBeTruthy();
    // two quick-adds: the timeline's all-day section + the weekly cell
    expect(screen.getAllByLabelText("Add task")).toHaveLength(2);
  });

  it("clicking a neighbor refocuses it, crossing the window", async () => {
    const onAnchorChange = renderView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mo 13" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mo 13" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-13");
  });
});
