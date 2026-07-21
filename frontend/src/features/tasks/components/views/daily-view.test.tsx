import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
});
afterAll(() => {
  vi.useRealTimers();
});

function renderView(onAnchorChange = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("DailyView v3 (single-day layout)", () => {
  it("renders no neighboring-day cells", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
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

  it("shows an unfinished future-day task from the week in the Weekly Task column, dated", async () => {
    const dayTask = makeTask({
      id: "d",
      title: "day task",
      scope: { kind: "day", date: "2026-07-17" },
    });
    renderView(vi.fn(), [dayTask]);
    await waitFor(() => expect(screen.getByText("day task")).toBeTruthy());
    expect(screen.getByText("Fri Jul 17")).toBeTruthy();
  });
});

describe("DailyView task detail panel", () => {
  // A Daily-tab all-day task is undone and scoped to a day inside the
  // rendered week, so per weeklyRollupTasks (frontend/src/features/tasks/lib/times.ts)
  // it also rolls up into the Weekly list alongside the Daily-tab's own
  // all-day-zone row — that's existing, deliberately-tested behavior, not
  // something DailyView filters out. So each task's title is expected twice
  // pre-selection (all-day zone + Weekly row) and three times once its panel
  // is open (+ panel header). Clicks are scoped to the all-day zone via
  // `within` since a bare `getByText` would otherwise be ambiguous.
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();

    const allDayZone = screen.getByTestId("all-day-zone");
    fireEvent.click(within(allDayZone).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    // Daily-tab row + Weekly rollup row + panel header
    expect(screen.getAllByText("task a")).toHaveLength(3);

    fireEvent.click(within(allDayZone).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(2); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(3);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the panel", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("all-day-zone")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });
});
