import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { MonthGrid } from "./month-grid";

function renderGrid({
  monthKey = "2026-07",
  selectedDate = null as string | null,
  onSelectDate = vi.fn(),
  onDrillDown = vi.fn(),
  tasks = [] as Parameters<typeof fakeRepository>[0],
} = {}) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <MonthGrid
        monthKey={monthKey}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onDrillDown={onDrillDown}
      />
    </TasksProvider>,
  );
  return { onSelectDate, onDrillDown };
}

describe("MonthGrid", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, a Thursday, within July
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders 5 rows of 7 real dates each for July 2026, including muted out-of-month days", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-01")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-06-28")).toBeTruthy(); // leading, out of month
    expect(screen.getByLabelText("Open 2026-08-01")).toBeTruthy(); // trailing, out of month
    expect(screen.getByLabelText("Open 2026-06-28").className).toContain("opacity-50");
    expect(screen.getByLabelText("Open 2026-07-16").className).not.toContain("opacity-50");
  });

  it("shows a week-of-year gutter label per row that drills to Weekly on click", async () => {
    const { onDrillDown } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-01")).toBeTruthy());
    const gutter = screen.getByLabelText("Open week of 2026-06-28 in Weekly");
    expect(gutter.textContent).toContain("›");
    fireEvent.click(gutter);
    expect(onDrillDown).toHaveBeenCalledWith("weekly", "2026-06-28");
  });

  it("clicking a day cell selects it", async () => {
    const { onSelectDate } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open 2026-07-14"));
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-14");
  });

  it("double-clicking a day cell drills down to Daily", async () => {
    const { onDrillDown } = renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Open 2026-07-14"));
    expect(onDrillDown).toHaveBeenCalledWith("daily", "2026-07-14");
  });

  it("shows a brand pill styling on today's date number, not on other dates", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-16")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-07-16").querySelector(".bg-brand")).toBeTruthy();
    expect(screen.getByLabelText("Open 2026-07-14").querySelector(".bg-brand")).toBeNull();
  });

  it("tints and rings the selected date's cell", async () => {
    renderGrid({ selectedDate: "2026-07-14" });
    await waitFor(() => expect(screen.getByLabelText("Open 2026-07-14")).toBeTruthy());
    expect(screen.getByLabelText("Open 2026-07-14").className).toContain("ring-brand");
    expect(screen.getByLabelText("Open 2026-07-16").className).not.toContain("ring-brand");
  });

  it("shows up to 2 active task titles, a done/total count, and a +N more overflow line", async () => {
    const tasks = [
      makeTask({ id: "a", title: "first", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({ id: "b", title: "second", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({ id: "c", title: "third", scope: { kind: "day", date: "2026-07-14" } }),
      makeTask({
        id: "d",
        title: "done one",
        done: true,
        scope: { kind: "day", date: "2026-07-14" },
      }),
    ];
    renderGrid({ tasks });
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.queryByText("third")).toBeNull(); // 3rd active title folds into overflow
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy(); // 1 done of 4 total, done not shown as a title
    expect(screen.queryByText("done one")).toBeNull();
  });
});
