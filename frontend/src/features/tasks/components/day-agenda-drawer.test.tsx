import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { todayKey, weekStartOf } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayAgendaDrawer } from "./day-agenda-drawer";

function renderDrawer({
  date = "2026-07-14",
  onClose = vi.fn(),
  onOpenDaily = vi.fn(),
  onSelectTask = vi.fn(),
  tasks = [] as Parameters<typeof fakeRepository>[0],
} = {}) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayAgendaDrawer
        date={date}
        onClose={onClose}
        onOpenDaily={onOpenDaily}
        onSelectTask={onSelectTask}
      />
    </TasksProvider>,
  );
  return { onClose, onOpenDaily, onSelectTask };
}

describe("DayAgendaDrawer", () => {
  it("shows the date's full task list via ScopeTasks", async () => {
    const day = todayKey();
    const t = makeTask({ title: "write plan", scope: { kind: "day", date: day } });
    renderDrawer({ date: day, tasks: [t] });
    await waitFor(() => expect(screen.getByText("write plan")).toBeTruthy());
  });

  describe("with a rolled-over task", () => {
    // Freeze "today" so the store's own rollover-on-load logic (which forwards
    // any week-scoped task whose weekStart predates the current week) doesn't
    // re-roll this already-rolled-over fixture out of the week we're testing.
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, Thursday
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("shows a rolled-over task (converted to week-scope by the rollover mechanism) for a past day", async () => {
      const day = "2026-07-14"; // a past day within the current week
      const t = makeTask({
        title: "overdue rollover task",
        scope: { kind: "week", weekStart: weekStartOf(day) },
        rolledFrom: { kind: "day", date: day },
      });
      renderDrawer({ date: day, tasks: [t] });
      await waitFor(() => expect(screen.getByText("overdue rollover task")).toBeTruthy());
    });
  });

  it("has a readable date heading", () => {
    renderDrawer({ date: "2026-07-14" });
    expect(screen.getByLabelText(/Tasks for/)).toBeTruthy();
  });

  it("Open Daily calls onOpenDaily", async () => {
    const { onOpenDaily } = renderDrawer();
    await waitFor(() => expect(screen.getByText("Open Daily")).toBeTruthy());
    fireEvent.click(screen.getByText("Open Daily"));
    expect(onOpenDaily).toHaveBeenCalledOnce();
  });

  it("the close button calls onClose", async () => {
    const { onClose } = renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Close day")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Close day"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose", async () => {
    const { onClose } = renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Close day")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("selecting a task inside the list calls onSelectTask with its id", async () => {
    const day = todayKey();
    const t = makeTask({ id: "a", title: "write plan", scope: { kind: "day", date: day } });
    const { onSelectTask } = renderDrawer({ date: day, tasks: [t] });
    await waitFor(() => expect(screen.getByText("write plan")).toBeTruthy());
    fireEvent.click(screen.getByText("write plan"));
    expect(onSelectTask).toHaveBeenCalledWith("a");
  });

  it("is full-screen by default and becomes a right-anchored panel at sm and up", () => {
    renderDrawer();
    const drawer = screen.getByTestId("day-agenda-drawer");
    expect(drawer.className).toContain("inset-0");
    expect(drawer.className).toContain("sm:right-0");
    expect(drawer.className).toContain("sm:w-[400px]");
  });
});
