import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgenda } from "./day-agenda";

const ANCHOR = "2026-07-16"; // Thursday; "today" under the pinned clock below

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

describe("DayAgenda sections", () => {
  it("shows a quick-add pinned at the bottom", async () => {
    renderAgenda(ANCHOR);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
  });

  it("puts an untimed, undone task under All Day To-Do", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.queryByText("Done Today")).toBeNull();
  });

  it("puts a timed, undone task under Next Up, sorted by time", async () => {
    const later = makeTask({
      id: "l",
      title: "later",
      time: "16:00",
      scope: { kind: "day", date: ANCHOR },
    });
    const earlier = makeTask({
      id: "e",
      title: "earlier",
      time: "15:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [later, earlier]);
    await waitFor(() => expect(screen.getByText("earlier")).toBeTruthy());
    expect(screen.getByText("Next Up")).toBeTruthy();
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("earlier");
    expect(items[1]).toContain("later");
  });

  it("puts a done task under Done Today regardless of timed/untimed", async () => {
    const doneTimed = makeTask({
      id: "dt",
      title: "done timed",
      time: "09:00",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    const doneUntimed = makeTask({
      id: "du",
      title: "done untimed",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [doneTimed, doneUntimed]);
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy());
    expect(screen.queryByText("All Day To-Do")).toBeNull();
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.getByText("done timed")).toBeTruthy();
    expect(screen.getByText("done untimed")).toBeTruthy();
  });

  it("hides a section entirely when it has no tasks", async () => {
    const t = makeTask({ id: "u", title: "only task", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("only task")).toBeTruthy());
    expect(screen.queryByText("Next Up")).toBeNull();
    expect(screen.queryByText("Done Today")).toBeNull();
  });

  it("excludes tasks from a different day", async () => {
    const other = makeTask({ id: "o", title: "other day", scope: { kind: "day", date: "2026-07-17" } });
    renderAgenda(ANCHOR, [other]);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("other day")).toBeNull();
  });

  it("renders each task as a large-size card", async () => {
    const t = makeTask({ id: "t", title: "big card", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("big card")).toBeTruthy());
    expect(screen.getByRole("button", { name: "big card" }).className).toContain("text-2xl");
  });

  it("calls onSelectTask instead of expanding inline when a card's title is clicked", async () => {
    const t = makeTask({ id: "t", title: "select me", scope: { kind: "day", date: ANCHOR } });
    const onSelectTask = vi.fn();
    renderAgenda(ANCHOR, [t], onSelectTask);
    await waitFor(() => expect(screen.getByText("select me")).toBeTruthy());
    fireEvent.click(screen.getByText("select me"));
    expect(onSelectTask).toHaveBeenCalledWith("t");
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });

  it("adds a day-scoped task via the bottom quick-add", async () => {
    renderAgenda(ANCHOR);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "new task" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("new task")).toBeTruthy());
  });
});

describe("DayAgenda same-day overdue highlighting", () => {
  it("marks a past-time undone task overdue when viewing today", async () => {
    const t = makeTask({
      id: "t",
      title: "morning meeting",
      time: "09:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("morning meeting")).toBeTruthy());
    const row = screen.getByText("morning meeting").closest("div");
    expect(row?.className).toContain("border-destructive");
  });

  it("marks a future-time undone task pending when viewing today", async () => {
    const t = makeTask({
      id: "t",
      title: "afternoon call",
      time: "16:00",
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("afternoon call")).toBeTruthy());
    const row = screen.getByText("afternoon call").closest("div");
    expect(row?.className).toContain("border-warning");
  });

  it("does not highlight timed tasks when viewing a day other than today", async () => {
    const other = "2026-07-17";
    const t = makeTask({
      id: "t",
      title: "tomorrow's task",
      time: "09:00",
      scope: { kind: "day", date: other },
    });
    renderAgenda(other, [t]);
    await waitFor(() => expect(screen.getByText("tomorrow's task")).toBeTruthy());
    const row = screen.getByText("tomorrow's task").closest("div");
    expect(row?.className).not.toContain("border-destructive");
    expect(row?.className).not.toContain("border-warning");
  });
});
