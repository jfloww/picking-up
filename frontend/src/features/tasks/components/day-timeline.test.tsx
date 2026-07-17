import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { todayKey } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayTimeline, HOUR_HEIGHT } from "./day-timeline";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5)); // Thu 2026-07-16 14:05
});
afterAll(() => {
  vi.useRealTimers();
});

function renderTimeline(date: string, tasks = [] as Parameters<typeof fakeRepository>[0]) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayTimeline date={date} />
    </TasksProvider>,
  );
}

describe("DayTimeline", () => {
  it("splits all-day and timed tasks; chips sit at their hour offset", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [untimed, timed]);

    await waitFor(() => expect(screen.getByText("untimed")).toBeTruthy());
    expect(screen.getByLabelText("Add task")).toBeTruthy();

    const chip = screen.getByTestId("chip-t");
    expect(chip.style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`); // 09:30 = 570min
    // focused chips must paint above later siblings so an expanded editor stays usable
    expect(chip.className).toContain("focus-within:z-30");
    expect(screen.getByText("dentist")).toBeTruthy();
  });

  it("shows the now line only on today, at the current time", async () => {
    const { unmount } = renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("now-line")).toBeTruthy());
    const nowTop = (14 * 60 + 5) * (HOUR_HEIGHT / 60);
    expect(screen.getByTestId("now-line").style.top).toBe(`${nowTop}px`);
    unmount();

    renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByTestId("now-line")).toBeNull();
  });

  it("defaults the rail scroll to 07:00", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("hour-rail").scrollTop).toBe(7 * HOUR_HEIGHT);
  });
});

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

describe("DayTimeline drag-to-schedule", () => {
  it("dragging an all-day task onto the rail sets its time", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    renderTimeline(day, [untimed]);
    await waitFor(() => expect(screen.getByTestId("all-day-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const source = screen.getByTestId("all-day-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 }); // -> 09:30
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });

    await waitFor(() => expect(screen.getByTestId("chip-u")).toBeTruthy());
    expect(screen.getByTestId("chip-u").style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`);
  });

  it("dragging a rail chip back onto the all-day zone clears its time", async () => {
    const day = todayKey();
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: day } });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const chip = screen.getByTestId("chip-t");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 10, clientY: 50 });

    await waitFor(() => expect(screen.getByTestId("all-day-t")).toBeTruthy());
    expect(screen.queryByTestId("chip-t")).toBeNull();
  });

  it("lays out same-time chips in side-by-side columns", async () => {
    const day = todayKey();
    const a = makeTask({ id: "a", title: "a", time: "09:00", scope: { kind: "day", date: day } });
    const b = makeTask({ id: "b", title: "b", time: "09:00", scope: { kind: "day", date: day } });
    renderTimeline(day, [a, b]);
    await waitFor(() => expect(screen.getByTestId("chip-a")).toBeTruthy());

    expect(screen.getByTestId("chip-a").style.width).toBe("calc(50% - 4px)");
    expect(screen.getByTestId("chip-b").style.width).toBe("calc(50% - 4px)");
    expect(screen.getByTestId("chip-a").style.left).toBe("calc(0% + 2px)");
    expect(screen.getByTestId("chip-b").style.left).toBe("calc(50% + 2px)");
  });

  it("shows a ghost and preview line while dragging, and hides both after drop", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    renderTimeline(day, [untimed]);
    await waitFor(() => expect(screen.getByTestId("all-day-u")).toBeTruthy());

    const rail = screen.getByTestId("hour-rail");
    mockRect(rail, { top: 100, bottom: 1300, left: 0, right: 300 });
    Object.defineProperty(rail, "scrollTop", { value: 0, writable: true });
    mockRect(screen.getByTestId("all-day-zone"), { top: 0, bottom: 90, left: 0, right: 300 });

    const source = screen.getByTestId("all-day-u");
    fireEvent.pointerDown(source, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 556 });

    expect(screen.getByTestId("drag-ghost").textContent).toBe("untimed");
    expect(screen.getByTestId("drag-preview-line").textContent).toBe("09:30");

    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 556 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});
