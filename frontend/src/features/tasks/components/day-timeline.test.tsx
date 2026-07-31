import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { todayKey } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeCategoryRepository, fakeRepository, makeTask } from "../test-utils";
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
    <TasksProvider repository={fakeRepository(tasks)} categoryRepository={fakeCategoryRepository()}>
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

  it("sizes a chip's height to its duration", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:00",
      durationMinutes: 45,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").style.height).toBe(`${(45 * HOUR_HEIGHT) / 60}px`);
  });

  it("falls back to the default compact height when no duration is set", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:00",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.getByTestId("chip-t").style.height).toBe("");
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

  it("also opens the drawer when the time badge (not just the title) is clicked", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const onSelectTask = vi.fn();
    renderTimeline(day, [timed], onSelectTask);
    await waitFor(() => expect(screen.getByText("9:30 AM")).toBeTruthy());

    fireEvent.click(screen.getByText("9:30 AM"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
  });

  it("makes the clickable area fill the whole chip, not just its content's natural height", async () => {
    // A chip taller than its title/time row (e.g. from a long duration) must
    // stay fully clickable, not just the top content-height sliver — the
    // outer chip is absolutely positioned and can be taller than its
    // content, so the inner click target has to explicitly fill it (inset-0)
    // rather than relying on its own content height.
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:00",
      durationMinutes: 90,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByRole("button", { name: "dentist" })).toBeTruthy());

    const clickTarget = screen.getByRole("button", { name: "dentist" }).closest("div")!;
    expect(clickTarget.className).toContain("absolute");
    expect(clickTarget.className).toContain("inset-0");
  });

  it("toggles completion from the chip's checkbox without opening the drawer", async () => {
    const day = todayKey();
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    const onSelectTask = vi.fn();
    renderTimeline(day, [timed], onSelectTask);
    await waitFor(() => expect(screen.getByLabelText("Toggle dentist")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Toggle dentist"));
    expect(onSelectTask).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Toggle dentist").getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("styles the chip's checkbox with the success token and completion pop", async () => {
    const day = todayKey();
    const timed = makeTask({ id: "t", title: "dentist", time: "09:30", scope: { kind: "day", date: day } });
    renderTimeline(day, [timed]);
    await waitFor(() => expect(screen.getByLabelText("Toggle dentist")).toBeTruthy());
    expect(screen.getByLabelText("Toggle dentist").className).toContain("data-checked:bg-success");
    expect(screen.getByLabelText("Toggle dentist").className).toContain(
      "data-checked:animate-task-complete",
    );
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

  it("renders no background lane when no task is marked background", async () => {
    const day = todayKey();
    const t = makeTask({ id: "t", title: "dentist", time: "09:00", scope: { kind: "day", date: day } });
    renderTimeline(day, [t]);
    await waitFor(() => expect(screen.getByTestId("chip-t")).toBeTruthy());
    expect(screen.queryByTestId("background-lane")).toBeNull();
    expect(screen.getByTestId("regular-lane").style.left).toBe("0px");
  });

  it("renders a background task in its own slim lane, separate from the regular lane", async () => {
    const day = todayKey();
    const long = makeTask({
      id: "long",
      title: "Long-Term Strategy",
      time: "08:00",
      durationMinutes: 540,
      background: true,
      scope: { kind: "day", date: day },
    });
    const regular = makeTask({
      id: "reg",
      title: "Finalize API proposal",
      time: "09:00",
      durationMinutes: 60,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [long, regular]);

    await waitFor(() => expect(screen.getByTestId("background-lane")).toBeTruthy());
    expect(screen.getByTestId("background-lane").contains(screen.getByTestId("chip-long"))).toBe(
      true,
    );
    expect(screen.getByTestId("regular-lane").contains(screen.getByTestId("chip-reg"))).toBe(
      true,
    );
    // the regular task doesn't overlap any other regular task, so it still gets full width
    expect(screen.getByTestId("chip-reg").style.width).toBe("calc(100% - 4px)");
  });

  it("shifts the regular lane to the right of the background lane when one exists", async () => {
    const day = todayKey();
    const long = makeTask({
      id: "long",
      title: "Long-Term Strategy",
      time: "08:00",
      durationMinutes: 540,
      background: true,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [long]);
    await waitFor(() => expect(screen.getByTestId("background-lane")).toBeTruthy());
    expect(screen.getByTestId("regular-lane").style.left).toBe("104px"); // 96 + 8
  });

  it("splits two regular tasks with overlapping durations (but different start times) into side-by-side columns", async () => {
    const day = todayKey();
    const long = makeTask({
      id: "a",
      title: "a",
      time: "08:00",
      durationMinutes: 540,
      scope: { kind: "day", date: day },
    });
    const short = makeTask({
      id: "b",
      title: "b",
      time: "09:00",
      durationMinutes: 60,
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [long, short]);
    await waitFor(() => expect(screen.getByTestId("chip-a")).toBeTruthy());
    expect(screen.getByTestId("chip-a").style.width).toBe("calc(50% - 4px)");
    expect(screen.getByTestId("chip-b").style.width).toBe("calc(50% - 4px)");
  });

  it("shows the drag preview line on the rail when dragState has a previewTime", async () => {
    const railRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(
      <TasksProvider repository={fakeRepository()} categoryRepository={fakeCategoryRepository()}>
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
