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
        cardRefs={{ current: {} }}
        dragState={null}
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
        <DayAgenda
          date={ANCHOR}
          agendaZoneRef={{ current: null }}
          getDragHandlers={noopGetDragHandlers}
          cardRefs={{ current: {} }}
          dragState={null}
        />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());

    const handleFirst = screen.getByLabelText("Reorder first");
    const cardFirst = screen.getByTestId("agenda-f");
    const cardSecond = screen.getByTestId("agenda-s");
    const list = screen.getByTestId("all-day-todo-list");
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
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

  it("releasing outside the All Day To-Do list cancels the drag: no reorderTask call, order unchanged, no indicator", async () => {
    const first = makeTask({ id: "f", title: "first", order: 1, scope: { kind: "day", date: ANCHOR } });
    const second = makeTask({ id: "s", title: "second", order: 2, scope: { kind: "day", date: ANCHOR } });
    const repo = fakeRepository([first, second]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda
          date={ANCHOR}
          agendaZoneRef={{ current: null }}
          getDragHandlers={noopGetDragHandlers}
          cardRefs={{ current: {} }}
          dragState={null}
        />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("first")).toBeTruthy());

    const handleFirst = screen.getByLabelText("Reorder first");
    const cardFirst = screen.getByTestId("agenda-f");
    const cardSecond = screen.getByTestId("agenda-s");
    const list = screen.getByTestId("all-day-todo-list");
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardFirst, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardSecond, "getBoundingClientRect").mockReturnValue({
      top: 50, bottom: 100, left: 0, right: 100, width: 100, height: 50, x: 0, y: 50, toJSON: () => {},
    } as DOMRect);

    fireEvent.pointerDown(handleFirst, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleFirst, { pointerId: 1, clientX: 10, clientY: 90 }); // still inside the list container (0-100)
    expect(screen.getByTestId("reorder-indicator")).toBeTruthy();
    fireEvent.pointerMove(handleFirst, { pointerId: 1, clientX: 10, clientY: 500 }); // well below the list container
    expect(screen.queryByTestId("reorder-indicator")).toBeNull();
    fireEvent.pointerUp(handleFirst, { pointerId: 1, clientX: 10, clientY: 500 });

    expect(repo.tasks.find((t) => t.id === "f")?.order).toBe(1);
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("first");
    expect(items[1]).toContain("second");
    expect(screen.queryByTestId("reorder-indicator")).toBeNull();
  });

  it("dropping a task back into its current position (adjacent to a different neighbor than itself) is a no-op", async () => {
    const a = makeTask({ id: "a", title: "alpha", order: 0.5, scope: { kind: "day", date: ANCHOR } });
    const b = makeTask({ id: "b", title: "bravo", order: 2, scope: { kind: "day", date: ANCHOR } });
    const c = makeTask({ id: "c", title: "charlie", order: 3, scope: { kind: "day", date: ANCHOR } });
    const repo = fakeRepository([a, b, c]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <DayAgenda
          date={ANCHOR}
          agendaZoneRef={{ current: null }}
          getDragHandlers={noopGetDragHandlers}
          cardRefs={{ current: {} }}
          dragState={null}
        />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    const reorderSpy = vi.spyOn(repo, "reorderTask");

    const handleA = screen.getByLabelText("Reorder alpha");
    const cardA = screen.getByTestId("agenda-a");
    const cardB = screen.getByTestId("agenda-b");
    const cardC = screen.getByTestId("agenda-c");
    const list = screen.getByTestId("all-day-todo-list");
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 150, left: 0, right: 100, width: 100, height: 150, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardA, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardB, "getBoundingClientRect").mockReturnValue({
      top: 50, bottom: 100, left: 0, right: 100, width: 100, height: 50, x: 0, y: 50, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardC, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 150, left: 0, right: 100, width: 100, height: 50, x: 0, y: 100, toJSON: () => {},
    } as DOMRect);

    // Drop directly above b (60 is within b's upper half, 50-100) — this is
    // exactly where "a" already sits, just resolved via b's id rather than
    // a's own id, so the naive `id === insertBeforeId` guard would miss it.
    fireEvent.pointerDown(handleA, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handleA, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(handleA, { pointerId: 1, clientX: 10, clientY: 60 });

    // The guard (if it fires) runs synchronously inside the pointerUp
    // handler, but `enqueueMutation` defers the actual `repo.reorderTask`
    // call by one microtask hop, so asserting immediately after fireEvent
    // would pass trivially regardless of whether the guard fired — the call
    // just hasn't reached the repo *yet* either way. Flushing past that hop
    // first (a macrotask boundary always runs after any already-queued
    // microtask) makes these assertions prove the guard actually suppressed
    // the call, not just that it hasn't landed within the same tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reorderSpy).not.toHaveBeenCalled();
    expect(repo.tasks.find((t) => t.id === "a")?.order).toBe(0.5);
    expect(repo.tasks.find((t) => t.id === "b")?.order).toBe(2);
    expect(repo.tasks.find((t) => t.id === "c")?.order).toBe(3);
    const items = screen.getAllByTestId(/^agenda-/).map((el) => el.textContent);
    expect(items[0]).toContain("alpha");
    expect(items[1]).toContain("bravo");
    expect(items[2]).toContain("charlie");
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
        <DayAgenda
          date={ANCHOR}
          agendaZoneRef={{ current: null }}
          getDragHandlers={getDragHandlers}
          cardRefs={{ current: {} }}
          dragState={null}
        />
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

describe("DayAgenda done-today transition animation", () => {
  it("does not animate a task that is already done on initial mount", async () => {
    const t = makeTask({ id: "d", title: "already done", done: true, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("already done")).toBeTruthy());
    const card = screen.getByTestId("agenda-d");
    expect(card.className).not.toContain("animate-task-enter");
    expect(card.className).not.toContain("animate-task-exit");
  });

  it("plays an exit animation in the old section right after checking a task, then an enter animation in Done Today", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Toggle water plants"));

    // still rendered in All Day To-Do, playing the exit animation
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.getByTestId("agenda-u").className).toContain("animate-task-exit");
    expect(screen.queryByText("Done Today")).toBeNull();

    // lands in Done Today playing the enter animation
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy(), { timeout: 1000 });
    expect(screen.getByTestId("agenda-u").className).toContain("animate-task-enter");

    // settles with no animation class once the transition finishes
    await waitFor(
      () => expect(screen.getByTestId("agenda-u").className).not.toContain("animate-task-enter"),
      { timeout: 1000 },
    );
  });

  it("mirrors the animation when unchecking a Done Today task back to All Day To-Do", async () => {
    const t = makeTask({ id: "d", title: "done item", done: true, scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("Done Today")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Toggle done item"));

    expect(screen.getByText("Done Today")).toBeTruthy();
    expect(screen.getByTestId("agenda-d").className).toContain("animate-task-exit");

    await waitFor(() => expect(screen.getByText("All Day To-Do")).toBeTruthy(), { timeout: 1000 });
    expect(screen.getByTestId("agenda-d").className).toContain("animate-task-enter");
  });

  it("never visibly lands in Done Today when checked then unchecked again before the exit animation finishes", async () => {
    const t = makeTask({ id: "u", title: "water plants", scope: { kind: "day", date: ANCHOR } });
    renderAgenda(ANCHOR, [t]);
    await waitFor(() => expect(screen.getByText("water plants")).toBeTruthy());

    // Re-query the checkbox before each click rather than reusing one
    // reference — it re-renders to a new node on toggle, and firing a
    // synthetic event on a stale/detached node is a silent no-op.
    fireEvent.click(screen.getByLabelText("Toggle water plants")); // check
    fireEvent.click(screen.getByLabelText("Toggle water plants")); // uncheck again, well before the 260ms exit finishes

    // still rendered under All Day To-Do the whole time — never teleports
    // through Done Today for a frame
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.queryByText("Done Today")).toBeNull();

    // settles back into All Day To-Do with no stuck animation class once
    // both the (cancelled-and-restarted) exit and the enter finish
    await waitFor(
      () => {
        const className = screen.getByTestId("agenda-u").className;
        expect(className).not.toContain("animate-task-exit");
        expect(className).not.toContain("animate-task-enter");
      },
      { timeout: 2000 },
    );
    expect(screen.getByText("All Day To-Do")).toBeTruthy();
    expect(screen.queryByText("Done Today")).toBeNull();
  });
});
