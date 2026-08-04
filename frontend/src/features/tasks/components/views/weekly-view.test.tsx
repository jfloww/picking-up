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
    // "This Week" is a static label present on the very first render,
    // before the store's initial-load promise resolves — waiting on it
    // doesn't prove tasks have loaded. "/1" only appears once the task
    // above has actually loaded and been counted (total starts at 0), so
    // it's the assertion that should gate the wait, not a sibling one.
    await waitFor(() => expect(screen.getByText("/1")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("counts a done task in the hero total", async () => {
    const a = makeTask({ title: "a", done: true, scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
    expect(screen.getByText("/1")).toBeTruthy();
  });

  it("excludes a task from another week from the hero count", async () => {
    // Includes an in-week task too, not just the out-of-week one: with only
    // the excluded task, the hero's final state (0/0) is identical to its
    // pre-load state, so a waitFor on it can pass before the store has
    // actually loaded anything — the in-week task gives "/1" a genuine
    // load-dependent value to wait on, while still proving "outside" (which
    // would push it to "/2") isn't counted.
    const inWeek = makeTask({ id: "in", title: "in week", scope: { kind: "day", date: "2026-07-14" } });
    const outside = makeTask({ id: "out", title: "outside", scope: { kind: "day", date: "2026-07-20" } });
    renderView(vi.fn(), [inWeek, outside]);
    await waitFor(() => expect(screen.getByText("/1")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("marks a past unfinished task overdue and today's unfinished task pending", async () => {
    // Previously (Task 5) this only checked day-column placement: wiring
    // ScopeTasks to always render Weekly's cards at size="week" when a drag
    // handle is present exposed that TaskItem's "week" branch didn't consume
    // the `highlight` prop at all, so the border-color distinction wasn't
    // observable here. TaskItem's "week" branch now applies highlight-driven
    // border/background classes (see task-item.tsx), restoring the original
    // assertions below.
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
    expect(screen.getByTestId("day-column-2026-07-14").textContent).toContain("overdue task");
    expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("pending task");
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

  it("reschedules a task dragged from one day into another, updating its scope and moving it in the UI", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-14").textContent).not.toContain("task a");
  });

  it("highlights the day column currently under the pointer while dragging cross-day, and clears it on drop", async () => {
    const a = makeTask({ id: "a", title: "task a", scope: { kind: "day", date: "2026-07-14" } });
    renderView(vi.fn(), [a]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const sourceColumn = screen.getByTestId("day-column-2026-07-14");
    const targetColumn = screen.getByTestId("day-column-2026-07-16");
    vi.spyOn(sourceColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    expect(targetColumn.className).toContain("ring-brand");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    expect(targetColumn.className).not.toContain("ring-brand");
  });

  it("dragging an untimed task to a new position within its own day reorders it and calls setOrder, not rescheduleTaskToDay", async () => {
    // Uses a date on/after the frozen "today" (2026-07-16), not "2026-07-14"
    // like most fixtures above: "2026-07-14" is before "today" and gets
    // converted to a week-scoped, rolled-over task by rollover logic on
    // mount (see the "future-dated, never-rolled-over" test's comment
    // below), which would make the plain day-scope equality assertion at
    // the end of this test fail for reasons unrelated to reordering.
    const first = makeTask({ id: "a", title: "first", order: 1, scope: { kind: "day", date: "2026-07-17" } });
    const second = makeTask({ id: "b", title: "second", order: 2, scope: { kind: "day", date: "2026-07-17" } });
    const repo = fakeRepository([first, second]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "first" })).toBeTruthy());

    const column = screen.getByTestId("day-column-2026-07-17");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    // Measure from the handle, not the title: TaskItem renders its own <li>
    // inside the row wrapper <li>, so getByText(...).closest("li") would
    // return the inner one — not the wrapper the drag hook registers in
    // itemRefs and calls getBoundingClientRect on. Mocking the inner li
    // leaves the hook reading jsdom's all-zero default rects.
    const cardFirst = screen.getByLabelText("Reorder first").closest("li")!;
    const cardSecond = screen.getByLabelText("Reorder second").closest("li")!;
    vi.spyOn(cardFirst, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardSecond, "getBoundingClientRect").mockReturnValue({
      top: 40, bottom: 80, left: 0, right: 100, width: 100, height: 40, x: 0, y: 40, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder first");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 70 }); // past second's midpoint
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 70 });

    await waitFor(() => expect(repo.tasks.find((t) => t.id === "a")?.order).toBeGreaterThan(2));
    expect(repo.tasks.find((t) => t.id === "a")?.scope).toEqual({ kind: "day", date: "2026-07-17" });
  });

  it("dragging a timed task within its own day is a no-op", async () => {
    const timed = makeTask({
      id: "a",
      title: "timed task",
      time: "09:00",
      order: 1,
      scope: { kind: "day", date: "2026-07-14" },
    });
    const repo = fakeRepository([timed]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "timed task" })).toBeTruthy());
    // Captured post-load (this fixture's date precedes the frozen "today",
    // so rollover has already rewritten its scope by now) — comparing
    // against the captured value proves the *drag* changed nothing, without
    // hardcoding rollover's output shape.
    const scopeBeforeDrag = repo.tasks.find((t) => t.id === "a")!.scope;

    const column = screen.getByTestId("day-column-2026-07-14");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder timed task");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    // Clearly past DRAG_THRESHOLD_PX (10), not sitting on its boundary, so
    // the gesture provably starts and the no-op below is the hook's
    // "reorder-noop" resolution rather than a drag that never began.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 45 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 45 });

    expect(repo.tasks.find((t) => t.id === "a")?.order).toBe(1);
    expect(repo.tasks.find((t) => t.id === "a")?.scope).toEqual(scopeBeforeDrag);
  });

  it("dropping an untimed task back on the position it already occupies writes nothing", async () => {
    // "task a" is already immediately above "task b", so dropping it into
    // b's upper half resolves to insertBeforeId "b" — a position that is
    // mathematically a new order value but visually the same slot. Without
    // the positional guard in onReorder this fires a real setOrder and a
    // repo.update network write for a no-op drag. Uses a future-dated day
    // so nothing rolls over on mount and every repo.update seen after load
    // is attributable to this drag.
    const a = makeTask({ id: "a", title: "task a", order: 1, scope: { kind: "day", date: "2026-07-17" } });
    const b = makeTask({ id: "b", title: "task b", order: 5, scope: { kind: "day", date: "2026-07-17" } });
    const repo = fakeRepository([a, b]);
    render(
      <TasksProvider repository={repo} categoryRepository={fakeCategoryRepository()}>
        <WeeklyView anchor={ANCHOR} onAnchorChange={vi.fn()} onDrillDown={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());
    const updateSpy = vi.spyOn(repo, "update");

    const column = screen.getByTestId("day-column-2026-07-17");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    // The row wrapper <li> (the element itemRefs registers) is the handle's
    // closest <li> — TaskItem renders a nested <li> of its own, so going via
    // the title text would mock the wrong element.
    const cardA = screen.getByLabelText("Reorder task a").closest("li")!;
    const cardB = screen.getByLabelText("Reorder task b").closest("li")!;
    vi.spyOn(cardA, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardB, "getBoundingClientRect").mockReturnValue({
      top: 40, bottom: 80, left: 0, right: 100, width: 100, height: 40, x: 0, y: 40, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 50 }); // b's upper half (40-60)
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50, clientY: 50 });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(repo.tasks.find((t) => t.id === "a")?.order).toBe(1);
    expect(screen.getByTestId("day-column-2026-07-17").textContent).toContain("task a");
  });

  it("shows a live insertion line at the drop position while dragging within a day, and clears it on drop", async () => {
    const a = makeTask({ id: "a", title: "task a", order: 1, scope: { kind: "day", date: "2026-07-17" } });
    const b = makeTask({ id: "b", title: "task b", order: 2, scope: { kind: "day", date: "2026-07-17" } });
    const c = makeTask({ id: "c", title: "task c", order: 3, scope: { kind: "day", date: "2026-07-17" } });
    renderView(vi.fn(), [a, b, c]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const column = screen.getByTestId("day-column-2026-07-17");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    // Row wrapper <li>s, reached via the handle — see the note on the
    // reorder test above for why the title's closest("li") is the wrong one.
    const cards = ["task a", "task b", "task c"].map(
      (t) => screen.getByLabelText(`Reorder ${t}`).closest("li")!,
    );
    cards.forEach((card, i) => {
      vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
        top: i * 40, bottom: i * 40 + 40, left: 0, right: 100, width: 100, height: 40,
        x: 0, y: i * 40, toJSON: () => {},
      } as DOMRect);
    });

    expect(screen.queryByTestId("reorder-indicator")).toBeNull();

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 90 }); // c's upper half (80-100)

    // Exactly one line, in the dragged task's own column only, sitting
    // immediately before the row it would be inserted above.
    expect(screen.getAllByTestId("reorder-indicator")).toHaveLength(1);
    const indicator = screen.getByTestId("reorder-indicator");
    expect(column.contains(indicator)).toBe(true);
    expect(indicator.nextElementSibling?.textContent).toContain("task c");

    // Live update: moving up to b's upper half moves the line with it.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    expect(screen.getByTestId("reorder-indicator").nextElementSibling?.textContent).toContain(
      "task b",
    );

    // Past every item: the line goes after the last row.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 200 });
    expect(screen.getByTestId("reorder-indicator").nextElementSibling).toBeNull();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50, clientY: 200 });
    expect(screen.queryByTestId("reorder-indicator")).toBeNull();
  });

  it("clears the insertion line when the drag is cancelled", async () => {
    const a = makeTask({ id: "a", title: "task a", order: 1, scope: { kind: "day", date: "2026-07-17" } });
    const b = makeTask({ id: "b", title: "task b", order: 2, scope: { kind: "day", date: "2026-07-17" } });
    renderView(vi.fn(), [a, b]);
    await waitFor(() => expect(screen.getByRole("button", { name: "task a" })).toBeTruthy());

    const column = screen.getByTestId("day-column-2026-07-17");
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    const cardA = screen.getByLabelText("Reorder task a").closest("li")!;
    const cardB = screen.getByLabelText("Reorder task b").closest("li")!;
    vi.spyOn(cardA, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(cardB, "getBoundingClientRect").mockReturnValue({
      top: 40, bottom: 80, left: 0, right: 100, width: 100, height: 40, x: 0, y: 40, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task b");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 10 }); // a's upper half
    expect(screen.getByTestId("reorder-indicator")).toBeTruthy();

    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(screen.queryByTestId("reorder-indicator")).toBeNull();
  });

  it("reschedules a future-dated, never-rolled-over task dragged into another day", async () => {
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
      top: 0, bottom: 300, left: 0, right: 100, width: 100, height: 300, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    vi.spyOn(targetColumn, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-18").textContent).toContain("task a"),
    );
    expect(screen.getByTestId("day-column-2026-07-17").textContent).not.toContain("task a");
  });

  it("reschedules an explicitly rolled-over task (week scope with a day rolledFrom), moving it to the dropped column", async () => {
    // Constructed directly with scope.kind "week" + rolledFrom, rather than
    // relying on the rollover mechanism to produce this shape implicitly.
    // This deliberately targets the rolled-over branch of rescheduleTaskToDay.
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
      top: 0, bottom: 300, left: 200, right: 300, width: 100, height: 300, x: 200, y: 0, toJSON: () => {},
    } as DOMRect);

    const handle = screen.getByLabelText("Reorder task a");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 250, clientY: 50 });

    await waitFor(() =>
      expect(screen.getByTestId("day-column-2026-07-16").textContent).toContain("task a"),
    );
  });
});
