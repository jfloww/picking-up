import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { MonthlyView } from "./monthly-view";
import { YearlyView } from "./yearly-view";

const ANCHOR = "2026-07-16";

describe("MonthlyView", () => {
  it("renders 12 months, fades non-current, and edits the focused month in the side cell", async () => {
    const task = makeTask({
      title: "july goal",
      scope: { kind: "month", month: "2026-07" },
    });
    render(
      <TasksProvider repository={fakeRepository([task])}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("2026")).toBeTruthy());
    expect(screen.getByText("January")).toBeTruthy();
    expect(screen.getByText("December")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    // task appears twice: compact preview in the July cell + editable side cell
    expect(screen.getAllByText("july goal")).toHaveLength(2);
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
    // 11 faded month cells are buttons
    expect(screen.getAllByRole("button", { name: /^Focus/ })).toHaveLength(11);
  });

  it("clicking a faded month refocuses to its first day", async () => {
    const onAnchorChange = vi.fn();
    render(
      <TasksProvider repository={fakeRepository()}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus March" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-03-01");
  });
});

describe("YearlyView", () => {
  it("renders all months without fading and a Yearly side cell", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <YearlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("Yearly")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: /^Focus/ })).toHaveLength(0);
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });
});
