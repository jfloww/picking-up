import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { HOUR_HEIGHT } from "../day-timeline";
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

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
    ...rect,
  } as DOMRect);
}

describe("DailyView v3 (single-day layout)", () => {
  it("renders no neighboring-day cells", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the timeline and the All day agenda side by side, one quick-add total", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });

  it("shows a timed task both as a rail chip and as an agenda card", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("agenda-t")).toBeTruthy();
    expect(screen.getAllByText("dentist")).toHaveLength(2);
  });

  it("lists an untimed task only in the agenda, not on the rail", async () => {
    const untimed = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());
    expect(screen.queryByTestId("chip-u")).toBeNull();
  });
});

describe("DailyView task detail panel", () => {
  it("opens the detail panel for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    // Wait for the tasks themselves, not just the (unconditionally-rendered,
    // initially-empty) agenda container — the store loads tasks async.
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // agenda only (untimed, no rail chip)

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getAllByText("task a")).toHaveLength(2); // agenda row + panel header

    // Re-query: the first click transitioned the right column from a bare
    // agenda to a ShrinkStack-wrapped agenda (a type change at that tree
    // position), which remounts DayAgenda — the pre-click node is stale.
    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // panel swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the panel when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    // Re-query for the same reason as above: the first click remounted
    // DayAgenda via the bare-agenda -> ShrinkStack type change.
    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the panel", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("renders the detail panel before the agenda list in document order", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    const panelPane = screen.getAllByTestId("shrink-stack-secondary")[0];
    const listPane = screen.getAllByTestId("shrink-stack-primary")[0];
    expect(
      panelPane.compareDocumentPosition(listPane) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("DailyView drag-to-schedule (cross-column)", () => {
  it("dragging an agenda card onto the rail sets its time", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const source = screen.getByTestId("agenda-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 }); // -> 09:30
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });

    await waitFor(() => expect(screen.getByTestId("chip-u")).toBeTruthy());
    expect(screen.getByTestId("chip-u").style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`);
  });

  it("dragging a rail chip onto the agenda list clears its time", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 450, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 450, clientY: 50 });

    await waitFor(() => expect(screen.queryByTestId("chip-t")).toBeNull());
    expect(screen.getByTestId("agenda-t")).toBeTruthy();
  });

  it("dragging a rail chip to a new rail position reschedules it (rail-to-rail)", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:00", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 148 }); // rail-relative y=48 -> 09:00
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 772 }); // rail-relative y=672 -> 14:00
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 772 });

    await waitFor(() =>
      expect(screen.getByTestId("chip-t").style.top).toBe(`${(14 * 60 * HOUR_HEIGHT) / 60}px`),
    );
  });

  it("dragging inside the expanded editor's memo textarea does not reschedule the task", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const originalTop = screen.getByTestId("chip-t").style.top;

    fireEvent.click(within(screen.getByTestId("hour-rail")).getByRole("button", { name: "dentist" }));
    const memo = await screen.findByPlaceholderText("Memo");

    fireEvent.pointerDown(memo, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(memo, { pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerUp(memo, { pointerId: 1, clientX: 10, clientY: 50 });

    expect(screen.getByTestId("chip-t").style.top).toBe(originalTop);
  });

  it("shows a ghost while dragging and hides it after drop", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [untimed]);
    await waitFor(() => expect(screen.getByTestId("agenda-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const source = screen.getByTestId("agenda-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 });

    expect(screen.getByTestId("drag-ghost").textContent).toBe("untimed");
    expect(screen.getByTestId("drag-preview-line").textContent).toBe("09:30");

    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});
