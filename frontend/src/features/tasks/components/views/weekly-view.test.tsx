import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { WeeklyView } from "./weekly-view";

const ANCHOR = "2026-07-16"; // focused week: 2026-07-12 .. 2026-07-18

function renderView(onAnchorChange = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <WeeklyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("WeeklyView", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, matches the fixtures
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders the month label, day headers, and Weekly column", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("July 2026")).toBeTruthy());
    expect(screen.getByText("Su")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
  });

  it("only the focused week offers quick-add inputs (7 days + weekly cell)", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getAllByLabelText("Add task")).toHaveLength(8),
    );
  });

  it("shows tasks of the focused week and faded rows are clickable", async () => {
    const task = makeTask({
      title: "focused task",
      scope: { kind: "day", date: "2026-07-16" },
    });
    const onAnchorChange = renderView(vi.fn(), [task]);
    await waitFor(() =>
      expect(screen.getAllByText("focused task")).toHaveLength(2),
    );

    const fadedRows = screen.getAllByRole("button", { name: /Week of/ });
    expect(fadedRows).toHaveLength(4); // July 2026 has 5 rows, 1 focused
    fireEvent.click(fadedRows[0]);
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-01");
  });

  it("shows an unfinished day task from the week in the Weekly column, dated", async () => {
    const dayTask = makeTask({
      id: "d",
      title: "weekly-rollup task",
      scope: { kind: "day", date: "2026-07-17" },
    });
    renderView(vi.fn(), [dayTask]);
    await waitFor(() => expect(screen.getByText("Fri Jul 17")).toBeTruthy());
  });
});
