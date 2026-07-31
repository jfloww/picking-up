import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeCategoryRepository, fakeRepository, makeTask } from "../../test-utils";
import { WeeklyView } from "./weekly-view";

const ANCHOR = "2026-07-16"; // Thursday; week: 2026-07-12 .. 2026-07-18

function renderView(onDrillDown = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)} categoryRepository={fakeCategoryRepository()}>
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

  it("drags a task from one day into another, updating its scope and moving it in the UI", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 100,
      width: 100,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-14").textContent).not.toContain("task a");
  });

  it("highlights the day column currently under the pointer while dragging, and clears it on drop", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    expect(targetColumn.className).toContain("ring-brand");

    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(targetColumn.className).not.toContain("ring-brand");
  });

  it("dropping back on the same day column leaves the task where it was", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 100,
      width: 100,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 60, clientY: 60 });

    expect(screen.getByTestId("day-column-2026-07-14").textContent).toContain("task a");
  });

  it("drags a future-dated, never-rolled-over task from one day into another, updating its scope and moving it in the UI", async () => {
    // Unlike the drag tests above (whose "2026-07-14" fixture is before the
    // frozen "today" of 2026-07-16 and therefore gets converted to a
    // week-scoped, rolled-over task by rollover logic on mount), this task's
    // date is on/after "today", so it stays a plain day-scoped task and this
    // test exercises the plain scope.kind === "day" drag path.
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-17" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-17");
    const targetColumn = screen.getByTestId("day-column-2026-07-18");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 100,
      width: 100,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-18").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-17").textContent).not.toContain("task a");
  });

  it("drags an explicitly rolled-over task (week scope with a day rolledFrom), moving it to the dropped column", async () => {
    // Constructed directly with scope.kind "week" + rolledFrom, rather than
    // relying on the rollover mechanism to produce this shape implicitly
    // (as the "2026-07-14" fixtures above incidentally do). This deliberately
    // targets the rolled-over branch of rescheduleTaskToDay. Fixture style
    // follows the "rescheduleTaskToDay moves a rolled-over task..." test in
    // store.test.tsx.
    const a = makeTask({
      id: "a",
      title: "task a",
      scope: { kind: "week", weekStart: "2026-07-12" },
      rolledFrom: { kind: "day", date: "2026-07-14" },
    });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 200,
      right: 300,
      width: 100,
      height: 300,
      x: 200,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    const chip = screen.getByText("task a").closest(".touch-none")!;
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
  });
});
