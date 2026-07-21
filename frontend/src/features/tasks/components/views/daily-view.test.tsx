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
  // The anchor day's own day-scoped tasks are excluded from the Weekly
  // rollup unconditionally (ScopeTasks' excludeDate), so a task only ever
  // shows in the all-day zone plus (once selected) the panel header — never
  // in the Weekly list too. Clicks are scoped to the all-day zone via
  // `within` since a bare `getByText` would otherwise be ambiguous once a
  // panel is open.
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // all-day zone only

    const allDayZone = screen.getByTestId("all-day-zone");
    fireEvent.click(within(allDayZone).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    // Daily-tab row + panel header (never the Weekly list)
    expect(screen.getAllByText("task a")).toHaveLength(2);

    fireEvent.click(within(allDayZone).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the panel when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    const allDayZone = screen.getByTestId("all-day-zone");
    fireEvent.click(within(allDayZone).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(within(allDayZone).getByText("task a"));
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

  it("renders the detail panel before the weekly list in document order", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("all-day-zone")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    const panelPane = screen.getAllByTestId("shrink-stack-secondary")[1];
    const listPane = screen.getAllByTestId("shrink-stack-primary")[1];
    expect(
      panelPane.compareDocumentPosition(listPane) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
