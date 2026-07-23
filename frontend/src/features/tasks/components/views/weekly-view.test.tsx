import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { WeeklyView } from "./weekly-view";

const ANCHOR = "2026-07-16"; // Thursday; week: 2026-07-12 .. 2026-07-18

function renderView(onDrillDown = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={onDrillDown} />
    </TasksProvider>,
  );
  return onDrillDown;
}

describe("WeeklyView", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, matches ANCHOR
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders exactly 7 day boxes for the anchor's week, Sunday through Saturday", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("Su 12")).toBeTruthy());
    expect(screen.getByText("Sa 18")).toBeTruthy();
    expect(screen.getAllByLabelText(/^Go to 2026-07-1[2-8]$/)).toHaveLength(7);
  });

  it("shows the hero's done/total count, 0 when nothing is done", async () => {
    const a = makeTask({ title: "a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("This Week")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("counts a done task in the hero total", async () => {
    const a = makeTask({ title: "a", done: true, scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("excludes a task from another week from the hero count", async () => {
    const outside = makeTask({ title: "outside", scope: { kind: "day", date: "2026-07-20" } });
    renderView(vi.fn(), [outside]);
    await waitFor(() => expect(screen.getByText("This Week")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("/0")).toBeTruthy();
  });

  it("marks a past unfinished task overdue and today's unfinished task pending", async () => {
    const overdue = makeTask({
      id: "o",
      title: "overdue task",
      scope: { kind: "day", date: "2026-07-14" },
    });
    const pending = makeTask({
      id: "p",
      title: "pending task",
      scope: { kind: "day", date: "2026-07-16" },
    });
    renderView(vi.fn(), [overdue, pending]);
    await waitFor(() => expect(screen.getByText("overdue task")).toBeTruthy());
    expect(screen.getByText("overdue task").closest("div")?.className).toContain(
      "border-destructive",
    );
    expect(screen.getByText("pending task").closest("div")?.className).toContain(
      "border-warning",
    );
  });

  it("shows a repeat cadence pill on a repeating task", async () => {
    const repeating = makeTask({
      id: "r",
      title: "gym",
      scope: { kind: "day", date: "2026-07-14" },
      repeatWeekdays: [1, 3, 5],
    });
    renderView(vi.fn(), [repeating]);
    await waitFor(() => expect(screen.getByText("gym")).toBeTruthy());
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
  });

  it("shows the anchor's upcoming repeat dates in the detail panel", async () => {
    const repeatingAnchor = makeTask({
      id: "r2",
      title: "yoga",
      scope: { kind: "day", date: "2026-07-14" },
      repeatWeekdays: [1, 3, 5], // Mon/Wed/Fri
    });
    renderView(vi.fn(), [repeatingAnchor]);
    await waitFor(() => expect(screen.getByRole("button", { name: "yoga" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    expect(screen.getByText(/Fri Jul 17, Mon Jul 20, Wed Jul 22/)).toBeTruthy();
  });

  it("opens the detail drawer when a task is clicked, and closes it on re-click", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "task a" }));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "task a" }));
    expect(screen.queryByLabelText("Close details")).toBeNull();
  });

  it("shrinks the week grid's available width while the drawer is open, so no day column hides behind it", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    expect(screen.getByTestId("weekly-view").className).not.toContain("pr-[400px]");

    fireEvent.click(screen.getByRole("button", { name: "task a" }));
    await waitFor(() => expect(screen.getByLabelText("Close details")).toBeTruthy());
    expect(screen.getByTestId("weekly-view").className).toContain("pr-[400px]");

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.getByTestId("weekly-view").className).not.toContain("pr-[400px]");
  });

  it("calls onDrillDown('daily', date) when a day's date is double-clicked", async () => {
    const onDrillDown = renderView();
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Go to 2026-07-14"));
    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });

  it("calls onDrillDown('daily', date) when Enter is pressed on a day's date button", async () => {
    const onDrillDown = renderView();
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.keyDown(screen.getByLabelText("Go to 2026-07-14"), { key: "Enter" });
    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });
});
