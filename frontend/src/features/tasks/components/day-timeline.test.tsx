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

const noopGetDragHandlers = () => ({
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onClickCapture: () => {},
});

function renderTimeline(
  date: string,
  tasks = [] as Parameters<typeof fakeRepository>[0],
  onSelectTask?: (id: string) => void,
) {
  const railRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const utils = render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayTimeline
        date={date}
        onSelectTask={onSelectTask}
        railRef={railRef}
        getDragHandlers={noopGetDragHandlers}
        dragState={null}
      />
    </TasksProvider>,
  );
  return { ...utils, railRef };
}

describe("DayTimeline", () => {
  it("renders a fixed Focus Agenda header with the timed task count", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const untimed = makeTask({
      id: "u",
      title: "groceries",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed, untimed]);

    await waitFor(() => expect(screen.getByText("Focus Agenda")).toBeTruthy());
    expect(screen.getByText("1 task scheduled today")).toBeTruthy();
    expect(screen.queryByText("Planned")).toBeNull();
    expect(screen.getByTestId("timeline-header").className).toContain("shrink-0");
    expect(screen.getByTestId("hour-rail").className).toContain("overflow-y-auto");
  });

  it("places timed task chips at their hour offset", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed]);

    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByTestId("now-line")).toBeNull();
  });

  it("on today, centers the rail scroll on the current time within a 12h viewport", async () => {
    const { railRef } = renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    // system time is 14:05; keep it centered within the 12-hour viewport.
    expect(railRef.current?.scrollTop).toBe(
      (845 * HOUR_HEIGHT) / 60 - (12 * HOUR_HEIGHT) / 2,
    );
  });

  it("on a non-today date, falls back to a 07:00 scroll start", async () => {
    const { railRef } = renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(railRef.current?.scrollTop).toBe(7 * HOUR_HEIGHT);
  });

  it("calls onSelectTask instead of expanding inline, for a rail chip", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const onSelectTask = vi.fn();
    renderTimeline(day, [timed], onSelectTask);
    await waitFor(() => expect(screen.getByText("dentist")).toBeTruthy());

    fireEvent.click(screen.getByText("dentist"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
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

  it("shows the drag preview line on the rail when dragState has a previewTime", async () => {
    const railRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(
      <TasksProvider repository={fakeRepository()}>
        <DayTimeline
          date={todayKey()}
          railRef={railRef}
          getDragHandlers={noopGetDragHandlers}
          dragState={{ id: "x", title: "dragging", pointerX: 0, pointerY: 0, previewTime: "09:30" }}
        />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("drag-preview-line")).toBeTruthy());
    expect(screen.getByTestId("drag-preview-line").style.top).toBe(
      `${(570 * HOUR_HEIGHT) / 60}px`,
    );
  });

  it("shows no drag preview line when dragState is null", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.queryByTestId("drag-preview-line")).toBeNull();
  });
});

describe("DayTimeline same-day overdue highlighting", () => {
  it("marks a past-time undone chip overdue when viewing today", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "morning meeting",
      time: "09:00",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").className).toContain("border-l-destructive");
  });

  it("marks a future-time undone chip pending when viewing today", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "afternoon call",
      time: "16:00",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").className).toContain("border-l-warning");
  });

  it("does not highlight a chip when viewing a non-today date", async () => {
    const other = "2026-07-17";
    const t = makeTask({
      id: "t",
      title: "tomorrow's task",
      time: "09:00",
      scope: { kind: "day", date: other },
    });
    renderTimeline(other, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").className).not.toContain("border-l-destructive");
  });

  it("does not highlight a done chip even past its time", async () => {
    const day = todayKey();
    const t = makeTask({
      id: "t",
      title: "done early task",
      time: "09:00",
      done: true,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").className).toContain("border-l-muted-foreground");
  });
});
