import { render, screen, waitFor } from "@testing-library/react";
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

describe("DailyView v3 (single-day layout)", () => {
  it("renders the day heading and no neighboring-day cells", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
    );
    // v2's peek columns rendered neighbor days as "Mo 13" / "Tu 14" / etc.
    // buttons; the redesign drops them entirely.
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the day's timeline and the week's task list side by side", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("Weekly")).toBeTruthy();
    // one quick-add for the timeline's all-day section, one for the weekly cell
    expect(screen.getAllByLabelText("Add task")).toHaveLength(2);
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });
});
