import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeCategoryRepository, fakeRepository, makeTask } from "../test-utils";
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
    <TasksProvider repository={fakeRepository(tasks)} categoryRepository={fakeCategoryRepository()}>
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
    expect(screen.getByPlaceholderText("New task")).toBeTruthy();
    expect(screen.getByTestId("day-agenda-scroll").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("day-agenda-footer").className).toContain("shrink-0");
    expect(screen.getByTestId("quick-add-panel-footer")).toBeTruthy();
  });

  it("puts an untimed, undone task under All Day To-Do", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.getByLabelText("All Day To-Do: 1").textContent).toBe("1");
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

  it("renders each task as a compact Daily card", async () => {
    const t = makeTask({ id: "t", title: "big card", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("big card")).toBeTruthy());
    expect(screen.getByRole("button", { name: "big card" }).className).toContain("text-[15px]");
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

  it("plain Enter adds a task without selecting it", async () => {
    const onSelectTask = vi.fn();
    renderAgenda(ANCHOR, [], onSelectTask);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "quick task" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("quick task")).toBeTruthy());
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it("Shift+Enter adds a task and immediately selects it to open its detail", async () => {
    const onSelectTask = vi.fn();
    renderAgenda(ANCHOR, [], onSelectTask);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "detailed task" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(screen.getByText("detailed task")).toBeTruthy());
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    const [selectedId] = onSelectTask.mock.calls[0];
    expect(screen.getByTestId(`agenda-${selectedId}`).textContent).toContain("detailed task");
  });

  it("the expand affordance adds a task and immediately selects it", async () => {
    const onSelectTask = vi.fn();
    renderAgenda(ANCHOR, [], onSelectTask);
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    const input = screen.getByLabelText("Add task");
    fireEvent.change(input, { target: { value: "expand task" } });
    fireEvent.click(screen.getByLabelText("Add and open task details"));
    await waitFor(() => expect(screen.getByText("expand task")).toBeTruthy());
    expect(onSelectTask).toHaveBeenCalledTimes(1);
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
    const row = screen.getByText("morning meeting").closest("li")?.firstElementChild;
    expect(row?.className).toContain("ring-destructive");
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
    const row = screen.getByText("afternoon call").closest("li")?.firstElementChild;
    expect(row?.className).not.toContain("ring-destructive");
    expect(screen.getByText("4:00 PM")).toBeTruthy();
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
    const row = screen.getByText("tomorrow's task").closest("li")?.firstElementChild;
    expect(row?.className).not.toContain("ring-destructive");
  });
});

describe("DayAgenda reorder handle", () => {
  it("shows a reorder handle on All Day To-Do cards, but not Next Up or Done Today", async () => {
    const todo = makeTask({ id: "t", title: "todo item", scope: { kind: "day", date: ANCHOR } });
    const timed = makeTask({
      id: "n",
      title: "next item",
      time: "10:00",
      scope: { kind: "day", date: ANCHOR },
    });
    const done = makeTask({
      id: "d",
      title: "done item",
      done: true,
      scope: { kind: "day", date: ANCHOR },
    });
    renderAgenda(ANCHOR, [todo, timed, done]);
    await waitFor(() => expect(screen.getByText("todo item")).toBeTruthy());
    expect(screen.getByLabelText("Reorder todo item")).toBeTruthy();
    expect(screen.queryByLabelText("Reorder next item")).toBeNull();
    expect(screen.queryByLabelText("Reorder done item")).toBeNull();
  });

  it("sorts All Day To-Do by order", async () => {
    const second = makeTask({ id: "s", title: "second", order: 2, scope: { kind: "day", date: ANCHOR } });
    const first = makeTask({ id: "f", title: "first", order: 1, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [second, first]);
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("first");
    expect(items[1]).toContain("second");
  });

  it("dragging the handle reorders All Day To-Do and persists the new order", async () => {
    const first = makeTask({ id: "f", title: "first", order: 1, scope: { kind: "day", date: ANCHOR } });
    const second = makeTask({ id: "s", title: "second", order: 2, scope: { kind: "day", date: ANCHOR } });
    const repo = fakeRepository([first, second]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda date={ANCHOR} agendaZoneRef={{ current: null }} getDragHandlers={noopGetDragHandlers} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());

    const handleFirst = screen.getByLabelText("Reorder first");
    const cardFirst = screen.getByTestId("agenda-f");
    const cardSecond = screen.getByTestId("agenda-s");
    vi.spyOn(cardFirst, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardSecond, "getBoundingClientRect").mockReturnValue({
      top: 50, bottom: 100, left: 0, right: 100, width: 100, height: 50, x: 0, y: 50, toJSON: () => {},
    } as DOMRect);

    fireEvent.pointerDown(handleFirst, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleFirst, { pointerId: 1, clientX: 10, clientY: 90 }); // past second's midpoint
    fireEvent.pointerUp(handleFirst, { pointerId: 1, clientX: 10, clientY: 90 });

    await waitFor(() => expect(repo.tasks.find((t) => t.id === "f")?.order).toBeGreaterThan(2));
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("second");
    expect(items[1]).toContain("first");
  });

  it("a handle-drag does not also trigger the existing drag-to-schedule gesture on the same card", async () => {
    const onScheduleSpy = vi.fn();
    const getDragHandlers = () => ({
      onPointerDown: onScheduleSpy,
      onPointerMove: () => {},
      onPointerUp: () => {},
      onPointerCancel: () => {},
      onClickCapture: () => {},
    });
    const t = makeTask({ id: "t", title: "todo item", scope: { kind: "day", date: ANCHOR } });
    render(
      <TasksProvider repository={fakeRepository([t])} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda date={ANCHOR} agendaZoneRef={{ current: null }} getDragHandlers={getDragHandlers} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("todo item")).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText("Reorder todo item"), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    expect(onScheduleSpy).not.toHaveBeenCalled();
  });
});
