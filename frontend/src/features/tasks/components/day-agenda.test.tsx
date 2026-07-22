import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgenda } from "./day-agenda";

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

function renderAgenda(
  date: string,
  tasks = [] as Parameters<typeof fakeRepository>[0],
  onSelectTask?: (id: string) => void,
) {
  const agendaZoneRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayAgenda
        date={date}
        onSelectTask={onSelectTask}
        agendaZoneRef={agendaZoneRef}
        getDragHandlers={noopGetDragHandlers}
      />
    </TasksProvider>,
  );
}

describe("DayAgenda", () => {
  it("shows the 'All day' label and a quick-add pinned at the bottom", async () => {
    renderAgenda("2026-07-16");
    await waitFor(() => expect(screen.getByText("All day")).toBeTruthy());
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });

  it("lists timed tasks in time order, untimed tasks after", async () => {
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: "2026-07-16" } });
    const later = makeTask({ id: "l", title: "later", time: "14:00", scope: { kind: "day", date: "2026-07-16" } });
    const earlier = makeTask({ id: "e", title: "earlier", time: "09:00", scope: { kind: "day", date: "2026-07-16" } });
    renderAgenda("2026-07-16", [untimed, later, earlier]);
    await waitFor(() => expect(screen.getByText("earlier")).toBeTruthy());
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("earlier");
    expect(items[1]).toContain("later");
    expect(items[2]).toContain("untimed");
  });

  it("excludes tasks from a different day", async () => {
    const other = makeTask({ id: "o", title: "other day", scope: { kind: "day", date: "2026-07-17" } });
    renderAgenda("2026-07-16", [other]);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("other day")).toBeNull();
  });

  it("renders each task as a large-size card", async () => {
    const t = makeTask({ id: "t", title: "big card", scope: { kind: "day", date: "2026-07-16" } });
    renderAgenda("2026-07-16", [t]);
    await waitFor(() => expect(screen.getByText("big card")).toBeTruthy());
    expect(screen.getByRole("button", { name: "big card" }).className).toContain("text-2xl");
  });

  it("calls onSelectTask instead of expanding inline when a card's title is clicked", async () => {
    const t = makeTask({ id: "t", title: "select me", scope: { kind: "day", date: "2026-07-16" } });
    const onSelectTask = vi.fn();
    renderAgenda("2026-07-16", [t], onSelectTask);
    await waitFor(() => expect(screen.getByText("select me")).toBeTruthy());
    fireEvent.click(screen.getByText("select me"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });

  it("adds a day-scoped task via the bottom quick-add", async () => {
    renderAgenda("2026-07-16");
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "new task" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("new task")).toBeTruthy());
  });
});
