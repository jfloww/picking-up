import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeCategoryRepository, fakeRepository, makeTask } from "../../test-utils";
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
    <TasksProvider repository={fakeRepository(tasks)} categoryRepository={fakeCategoryRepository()}>
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

describe("DailyView v4 (60/40 layout, drawer overlay)", () => {
  it("renders no neighboring-day cells", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(
      screen.queryAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ }),
    ).toHaveLength(0);
  });

  it("shows the timeline and agenda side by side, one quick-add total", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("daily-layout").className).toContain(
      "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
    );
    expect(screen.getByTestId("timeline-panel").className).toContain("border-r");
    expect(screen.getByTestId("agenda-panel")).toBeTruthy();
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByTestId("day-agenda")).toBeTruthy();
    expect(screen.getByTestId("day-agenda-scroll").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("day-agenda-footer").className).toContain("shrink-0");
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
    expect(screen.getByPlaceholderText("New task")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new task/i })).toBeNull();
  });

  it("never calls onAnchorChange itself (only the toolbar changes the focused day)", async () => {
    const onAnchorChange = renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(onAnchorChange).not.toHaveBeenCalled();
  });

  it("shows a timed task both as a rail chip and as an agenda card", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
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

describe("DailyView task detail drawer", () => {
  it("opens the drawer for a Daily-tab task, closes on re-click, and swaps on a different task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "task b", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());
    expect(screen.queryByLabelText("Close details")).toBeNull();
    expect(screen.getAllByText("task a")).toHaveLength(1); // agenda only

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getAllByText("task a")).toHaveLength(2); // agenda card + drawer header

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task b"));
    expect(screen.getAllByText("task a")).toHaveLength(1); // drawer swapped away
    expect(screen.getAllByText("task b")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the drawer when the same task's title is clicked again", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("closes the drawer on Escape", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("clears the selection when the selected task is deleted from the drawer", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Delete task"));
    fireEvent.click(screen.getByText("Confirm delete"));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("renders the drawer as a fixed overlay while both columns stay full-size", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    expect(screen.getByTestId("task-detail-drawer").className).toContain("fixed");
    expect(screen.getByTestId("hour-rail")).toBeTruthy();
    expect(screen.getByTestId("day-agenda")).toBeTruthy();
  });

  it("shows the anchor's upcoming repeat dates in the drawer", async () => {
    const anchor = makeTask({
      id: "a",
      title: "gym",
      scope: { kind: "day", date: ANCHOR },
      repeatWeekdays: [1, 3, 5], // Mon/Wed/Fri
    });
    renderView(vi.fn(), [anchor]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("gym"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    expect(screen.getByText(/Fri Jul 17, Mon Jul 20, Wed Jul 22/)).toBeTruthy();
  });

  it("shows a generated occurrence's upcoming repeat dates resolved from its anchor", async () => {
    const anchor = makeTask({
      id: "anchor",
      title: "gym",
      scope: { kind: "week", weekStart: "2026-07-12" },
      repeatWeekdays: [1, 3, 5],
    });
    const instance = makeTask({
      id: "inst",
      title: "gym",
      scope: { kind: "day", date: ANCHOR },
      repeatSourceId: "anchor",
    });
    renderView(vi.fn(), [anchor, instance]);
    await waitFor(() => expect(screen.getByTestId("agenda-inst")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("gym"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    expect(screen.getByText(/Fri Jul 17, Mon Jul 20, Wed Jul 22/)).toBeTruthy();
  });

  it("shows no upcoming repeat dates for a non-repeating task", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    fireEvent.click(within(screen.getByTestId("day-agenda")).getByText("task a"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());

    expect(screen.queryByText(/Next:/)).toBeNull();
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
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 708 }); // -> 09:30
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 708 });

    await waitFor(() => expect(screen.getByTestId("chip-u")).toBeTruthy());
    expect(screen.getByTestId("chip-u").style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`);
  });

  it("dragging a rail chip onto the agenda list clears its time", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
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
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 996 }); // rail-relative y=896 -> 14:00
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 996 });

    await waitFor(() =>
      expect(screen.getByTestId("chip-t").style.top).toBe(`${(14 * 60 * HOUR_HEIGHT) / 60}px`),
    );
  });

  it("dragging a rail chip does not open its detail drawer", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "09:00", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 148 }); // rail-relative y=48 -> 09:00
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 996 }); // rail-relative y=896 -> 14:00
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 996 });

    await waitFor(() =>
      expect(screen.getByTestId("chip-t").style.top).toBe(`${(14 * 60 * HOUR_HEIGHT) / 60}px`),
    );
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("dragging inside the expanded editor's memo textarea does not reschedule the task", async () => {
    const timed = makeTask({ id: "t", title: "dentist", time: "16:00", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 90, left: 400, right: 700 });

    const originalTop = screen.getByTestId("chip-t").style.top;

    fireEvent.click(within(screen.getByTestId("hour-rail")).getByRole("button", { name: "dentist" }));
    fireEvent.click(await screen.findByText("Add a note…"));
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
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 708 });

    expect(screen.getByTestId("drag-ghost").textContent).toBe("untimed");
    expect(screen.getByTestId("drag-preview-line").textContent).toBe("09:30");

    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 708 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });

  it("still opens the drawer when a click carries a few pixels of incidental jitter", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: ANCHOR } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByTestId("agenda-a")).toBeTruthy());

    const title = within(screen.getByTestId("agenda-a")).getByText("task a");
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 107, clientY: 100 }); // 7px of jitter, under DRAG_THRESHOLD_PX
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 107, clientY: 100 });
    fireEvent.click(title);

    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
  });
});

describe("DailyView drag-to-nest-subtask", () => {
  async function setupCards(source: ReturnType<typeof makeTask>, target: ReturnType<typeof makeTask>) {
    renderView(vi.fn(), [source, target]);
    // TasksProvider loads tasks asynchronously (repo.list() resolves via a
    // microtask), so agenda-${target.id} doesn't exist synchronously after
    // render — wait for it before mocking its rect, matching every other
    // test in this file.
    await waitFor(() => expect(screen.getByTestId(`agenda-${target.id}`)).toBeTruthy());
    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 2000, bottom: 3000, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("day-agenda"), { top: 0, bottom: 500, left: 400, right: 700 });
    mockRect(screen.getByTestId(`agenda-${target.id}`), { top: 100, bottom: 150, left: 400, right: 700 });
  }

  function dragOnto(sourceId: string) {
    const sourceEl = screen.getByTestId(`agenda-${sourceId}`);
    fireEvent.pointerDown(sourceEl, { pointerId: 1, clientX: 410, clientY: 10 });
    fireEvent.pointerMove(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });
    return sourceEl;
  }

  it("converts a simple dragged task into a subtask immediately, no confirmation", async () => {
    const source = makeTask({ id: "s", title: "buy milk", scope: { kind: "day", date: ANCHOR } });
    const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("agenda-s")).toBeNull());

    fireEvent.click(screen.getByText("groceries"));
    expect(await screen.findByText("buy milk")).toBeTruthy();
  });

  it("shows a confirmation dialog for a task with extra fields, and converts on Confirm", async () => {
    const source = makeTask({
      id: "s",
      title: "call plumber",
      memo: "ask about pricing",
      scope: { kind: "day", date: ANCHOR },
    });
    const target = makeTask({ id: "t", title: "house stuff", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/note/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy(); // not converted yet

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByTestId("agenda-s")).toBeNull());
  });

  it("cancelling the confirmation dialog leaves the task unchanged", async () => {
    const source = makeTask({
      id: "s",
      title: "call plumber",
      memo: "ask about pricing",
      scope: { kind: "day", date: ANCHOR },
    });
    const target = makeTask({ id: "t", title: "house stuff", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("shows a blocked message and does not convert when the dragged task already has subtasks", async () => {
    const source = makeTask({
      id: "s",
      title: "planning",
      scope: { kind: "day", date: ANCHOR },
      subtasks: [{ id: "sub1", title: "step 1", done: false }],
    });
    const target = makeTask({ id: "t", title: "project", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByText(/already has subtasks/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("shows a blocked message for a repeating task and does not convert", async () => {
    const source = makeTask({
      id: "s",
      title: "weekly review",
      scope: { kind: "day", date: ANCHOR },
      repeatWeekdays: [4],
    });
    const target = makeTask({ id: "t", title: "misc", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    const sourceEl = dragOnto("s");
    fireEvent.pointerUp(sourceEl, { pointerId: 1, clientX: 410, clientY: 120 });

    expect(await screen.findByText(/detached from their series/)).toBeTruthy();
    expect(screen.getByTestId("agenda-s")).toBeTruthy();
  });

  it("highlights the hovered target card while dragging an eligible task", async () => {
    const source = makeTask({ id: "s", title: "buy milk", scope: { kind: "day", date: ANCHOR } });
    const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: ANCHOR } });
    await setupCards(source, target);
    await waitFor(() => expect(screen.getByTestId("agenda-s")).toBeTruthy());

    dragOnto("s");
    expect(screen.getByTestId("agenda-t").className).toContain("ring-brand");
  });
});
