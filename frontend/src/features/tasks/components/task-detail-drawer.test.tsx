import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeCategory, makeTask } from "../test-utils";
import { TaskDetailDrawer } from "./task-detail-drawer";

const noopHandlers = {
  onToggle: () => {},
  onClose: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onRepeatWeekdaysChange: (_weekdays: number[]) => {},
  onDetachFromRoutine: (_weekdays?: number[]) => {},
  onPriorityChange: (_priority: boolean) => {},
  onDurationChange: (_durationMinutes?: number) => {},
  onBackgroundChange: (_background: boolean) => {},
  onDueDateChange: (_dueDate?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
  onEditSubtaskTitle: (_id: string, _title: string) => {},
  onEditSubtaskMemo: (_id: string, _memo: string) => {},
  onPromoteSubtask: (_subtaskId: string) => undefined,
  onUndoPromoteSubtask: (_taskId: string) => {},
  onCategoryChange: (_category: string) => {},
};

describe("TaskDetailDrawer", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("shows the task's checkbox, title, and memo", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByText("write tests")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value,
    ).toBe("with care");
  });

  it("styles the header checkbox with the success token and completion pop", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByRole("checkbox").className).toContain("data-checked:bg-success");
    expect(screen.getByRole("checkbox").className).toContain("data-checked:animate-task-complete");
  });

  it("renders as a fixed-position overlay, not swapped inline", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    const drawer = screen.getByTestId("task-detail-drawer");
    expect(drawer.className).toContain("fixed");
    expect(drawer.className).toContain("w-[420px]");
    expect(screen.getByText("Task Details")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("is translated into view once mounted", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByTestId("task-detail-drawer").className).toContain("translate-x-0");
  });

  it("carries a translate-transform transition for the slide-in animation", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    expect(screen.getByTestId("task-detail-drawer").className).toContain(
      "transition-transform",
    );
  });

  describe("completion date/time", () => {
    it("shows when the task was completed, for a done task", () => {
      const doneTask = makeTask({
        id: "c",
        title: "shipped it",
        done: true,
        completedAt: "2026-07-16T13:45:00.000Z",
      });
      render(<TaskDetailDrawer task={doneTask} {...noopHandlers} />);
      const expected = new Date("2026-07-16T13:45:00.000Z");
      const expectedDate = expected.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const expectedTime = expected.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      expect(screen.getByText(`Completed ${expectedDate} at ${expectedTime}`)).toBeTruthy();
    });

    it("shows nothing for a not-done task, even if it has a stale completedAt", () => {
      const task = makeTask({ id: "n", title: "not done", done: false, completedAt: "2026-07-16T13:45:00.000Z" });
      render(<TaskDetailDrawer task={task} {...noopHandlers} />);
      expect(screen.queryByText(/^Completed/)).toBeNull();
    });

    it("shows nothing for a done task with no completedAt recorded", () => {
      const doneTask = makeTask({ id: "d", title: "done, no timestamp", done: true });
      render(<TaskDetailDrawer task={doneTask} {...noopHandlers} />);
      expect(screen.queryByText(/^Completed/)).toBeNull();
    });

    it("does not show a preview based on an uncommitted checkbox toggle in the drawer", () => {
      render(<TaskDetailDrawer task={task} {...noopHandlers} />);
      fireEvent.click(screen.getByRole("checkbox"));
      expect(screen.queryByText(/^Completed/)).toBeNull();
    });
  });

  it("removes its Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows exactly one time input, not duplicated", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task time")).toHaveLength(1);
  });

  it("shows exactly one end-time input, next to Start, not duplicated", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task end time")).toHaveLength(1);
  });

  it("threads upcomingRepeatDates through to TaskDetailFields", () => {
    render(
      <TaskDetailDrawer
        task={task}
        {...noopHandlers}
        upcomingRepeatDates={["Fri Jul 17", "Mon Jul 20"]}
      />,
    );
    expect(screen.getByText(/Fri Jul 17, Mon Jul 20/)).toBeTruthy();
  });

  describe("draft editing (buffered until Done)", () => {
    it("does not call any commit handler immediately when the checkbox, priority, background, duration, time, memo, or repeat are edited", () => {
      const handlers = {
        onToggle: vi.fn(),
        onPriorityChange: vi.fn(),
        onBackgroundChange: vi.fn(),
        onDurationChange: vi.fn(),
        onTimeChange: vi.fn(),
        onMemoChange: vi.fn(),
        onRepeatWeekdaysChange: vi.fn(),
      };
      const timedTask = makeTask({ id: "a", title: "write tests", time: "09:00" });
      render(<TaskDetailDrawer task={timedTask} {...noopHandlers} {...handlers} />);

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      fireEvent.click(screen.getByRole("button", { name: "Background" }));
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
      fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "11:15" } });
      fireEvent.click(screen.getByText("Add a note…"));
      fireEvent.change(screen.getByPlaceholderText("Memo"), { target: { value: "updated" } });
      fireEvent.blur(screen.getByPlaceholderText("Memo"));
      fireEvent.click(screen.getByLabelText("Repeat on Monday"));

      expect(handlers.onToggle).not.toHaveBeenCalled();
      expect(handlers.onPriorityChange).not.toHaveBeenCalled();
      expect(handlers.onBackgroundChange).not.toHaveBeenCalled();
      expect(handlers.onDurationChange).not.toHaveBeenCalled();
      expect(handlers.onTimeChange).not.toHaveBeenCalled();
      expect(handlers.onMemoChange).not.toHaveBeenCalled();
      expect(handlers.onRepeatWeekdaysChange).not.toHaveBeenCalled();
    });

    it("reflects edits visually right away, even though nothing has been committed", () => {
      render(<TaskDetailDrawer task={task} {...noopHandlers} />);
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      expect(
        screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
      ).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "Background" }));
      expect(
        screen.getByRole("button", { name: "Background" }).getAttribute("aria-pressed"),
      ).toBe("true");

      const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(screen.getByText("write tests").className).toContain("line-through");
    });

    it("Done commits every edited field and then closes", () => {
      const handlers = {
        onToggle: vi.fn(),
        onPriorityChange: vi.fn(),
        onBackgroundChange: vi.fn(),
        onDurationChange: vi.fn(),
        onTimeChange: vi.fn(),
        onMemoChange: vi.fn(),
        onRepeatWeekdaysChange: vi.fn(),
        onClose: vi.fn(),
      };
      const timedTask = makeTask({ id: "a", title: "write tests", time: "09:00", memo: "old" });
      render(<TaskDetailDrawer task={timedTask} {...noopHandlers} {...handlers} />);

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      fireEvent.click(screen.getByRole("button", { name: "Background" }));
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
      fireEvent.change(screen.getByLabelText("Task end time"), { target: { value: "11:15" } });
      fireEvent.change(screen.getByPlaceholderText("Memo"), { target: { value: "updated" } });
      fireEvent.blur(screen.getByPlaceholderText("Memo"));
      fireEvent.click(screen.getByLabelText("Repeat on Monday"));

      fireEvent.click(screen.getByText("Done"));

      expect(handlers.onToggle).toHaveBeenCalledTimes(1);
      expect(handlers.onPriorityChange).toHaveBeenCalledWith(true);
      expect(handlers.onBackgroundChange).toHaveBeenCalledWith(true);
      expect(handlers.onDurationChange).toHaveBeenCalledWith(45);
      expect(handlers.onTimeChange).toHaveBeenCalledWith("10:30");
      expect(handlers.onMemoChange).toHaveBeenCalledWith("updated");
      expect(handlers.onRepeatWeekdaysChange).toHaveBeenCalledWith([1]);
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it("Done does not call commit handlers for fields that were never touched", () => {
      const handlers = {
        onToggle: vi.fn(),
        onPriorityChange: vi.fn(),
        onBackgroundChange: vi.fn(),
        onDurationChange: vi.fn(),
        onTimeChange: vi.fn(),
        onMemoChange: vi.fn(),
        onRepeatWeekdaysChange: vi.fn(),
      };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);
      fireEvent.click(screen.getByText("Done"));

      expect(handlers.onToggle).not.toHaveBeenCalled();
      expect(handlers.onPriorityChange).not.toHaveBeenCalled();
      expect(handlers.onBackgroundChange).not.toHaveBeenCalled();
      expect(handlers.onDurationChange).not.toHaveBeenCalled();
      expect(handlers.onTimeChange).not.toHaveBeenCalled();
      expect(handlers.onMemoChange).not.toHaveBeenCalled();
      expect(handlers.onRepeatWeekdaysChange).not.toHaveBeenCalled();
    });

    it("Cancel discards every edit and closes without calling any commit handler", () => {
      const handlers = {
        onToggle: vi.fn(),
        onPriorityChange: vi.fn(),
        onMemoChange: vi.fn(),
        onClose: vi.fn(),
      };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      fireEvent.change(screen.getByPlaceholderText("Memo"), { target: { value: "updated" } });
      fireEvent.blur(screen.getByPlaceholderText("Memo"));

      fireEvent.click(screen.getByText("Cancel"));

      expect(handlers.onToggle).not.toHaveBeenCalled();
      expect(handlers.onPriorityChange).not.toHaveBeenCalled();
      expect(handlers.onMemoChange).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it("closing via the X button discards edits without calling any commit handler", () => {
      const handlers = { onPriorityChange: vi.fn(), onClose: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      fireEvent.click(screen.getByLabelText("Close details"));
      expect(handlers.onPriorityChange).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it("pressing Escape discards edits without calling any commit handler", () => {
      const handlers = { onPriorityChange: vi.fn(), onClose: vi.fn() };
      render(<TaskDetailDrawer task={task} {...noopHandlers} {...handlers} />);
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(handlers.onPriorityChange).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it("resets the draft to the new task's values when switching to a different task", () => {
      const taskA = makeTask({ id: "a", title: "task a", priority: false });
      const taskB = makeTask({ id: "b", title: "task b", priority: true });
      const { rerender } = render(<TaskDetailDrawer task={taskA} {...noopHandlers} />);

      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
      expect(
        screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
      ).toBe("true");

      rerender(<TaskDetailDrawer task={taskB} {...noopHandlers} />);
      expect(
        screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed"),
      ).toBe("true"); // taskB's own real value, not taskA's uncommitted edit
    });
  });

  describe("due date editing (buffered until Done)", () => {
    it("does not call onDueDateChange immediately when the due date is edited", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      expect(onDueDateChange).not.toHaveBeenCalled();
    });

    it("Done commits the edited due date", () => {
      const onDueDateChange = vi.fn();
      const onClose = vi.fn();
      render(
        <TaskDetailDrawer
          task={task}
          {...noopHandlers}
          onDueDateChange={onDueDateChange}
          onClose={onClose}
        />,
      );
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      fireEvent.click(screen.getByText("Done"));
      expect(onDueDateChange).toHaveBeenCalledWith("2026-07-31");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Done does not call onDueDateChange when the due date was never touched", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.click(screen.getByText("Done"));
      expect(onDueDateChange).not.toHaveBeenCalled();
    });

    it("Cancel discards the edited due date", () => {
      const onDueDateChange = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDueDateChange={onDueDateChange} />);
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-31" } });
      fireEvent.click(screen.getByText("Cancel"));
      expect(onDueDateChange).not.toHaveBeenCalled();
    });
  });

  describe("detaching from a routine occurrence", () => {
    const routineTask = makeTask({
      id: "occ",
      title: "gym",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor-1",
    });

    it("swaps the routine label for the weekday picker immediately when Detach is clicked, before Done", () => {
      render(<TaskDetailDrawer task={routineTask} {...noopHandlers} />);
      expect(screen.getByLabelText("Part of a routine")).toBeTruthy();

      fireEvent.click(screen.getByText("Detach"));

      expect(screen.queryByLabelText("Part of a routine")).toBeNull();
      expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
    });

    it("Done calls onDetachFromRoutine with no weekdays when none were chosen after detaching", () => {
      const onDetachFromRoutine = vi.fn();
      const onRepeatWeekdaysChange = vi.fn();
      render(
        <TaskDetailDrawer
          task={routineTask}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
          onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        />,
      );

      fireEvent.click(screen.getByText("Detach"));
      fireEvent.click(screen.getByText("Done"));

      expect(onDetachFromRoutine).toHaveBeenCalledWith(undefined);
      expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
    });

    it("Done calls onDetachFromRoutine with the chosen weekdays when the picker was also used", () => {
      const onDetachFromRoutine = vi.fn();
      const onRepeatWeekdaysChange = vi.fn();
      render(
        <TaskDetailDrawer
          task={routineTask}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
          onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        />,
      );

      fireEvent.click(screen.getByText("Detach"));
      fireEvent.click(screen.getByLabelText("Repeat on Monday"));
      fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
      fireEvent.click(screen.getByText("Done"));

      expect(onDetachFromRoutine).toHaveBeenCalledWith([1, 3]);
      expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
    });

    it("Cancel after Detach discards the change and calls neither commit handler", () => {
      const onDetachFromRoutine = vi.fn();
      const onRepeatWeekdaysChange = vi.fn();
      render(
        <TaskDetailDrawer
          task={routineTask}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
          onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        />,
      );

      fireEvent.click(screen.getByText("Detach"));
      fireEvent.click(screen.getByText("Cancel"));

      expect(onDetachFromRoutine).not.toHaveBeenCalled();
      expect(onRepeatWeekdaysChange).not.toHaveBeenCalled();
    });

    it("Done does not call onDetachFromRoutine when Detach was never clicked", () => {
      const onDetachFromRoutine = vi.fn();
      render(
        <TaskDetailDrawer
          task={routineTask}
          {...noopHandlers}
          onDetachFromRoutine={onDetachFromRoutine}
        />,
      );
      fireEvent.click(screen.getByText("Done"));
      expect(onDetachFromRoutine).not.toHaveBeenCalled();
    });
  });

  describe("deleting (immediate once confirmed, not deferred to Done)", () => {
    it("does not call onDelete on the first click — it asks for confirmation instead", () => {
      const onDelete = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} />);
      fireEvent.click(screen.getByLabelText("Delete task"));
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByText("Confirm delete")).toBeTruthy();
    });

    it("calls onDelete once the confirmation button is clicked", () => {
      const onDelete = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} />);
      fireEvent.click(screen.getByLabelText("Delete task"));
      fireEvent.click(screen.getByText("Confirm delete"));
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("Cancel on the confirmation step backs out without deleting, restoring Done/Cancel/trash", () => {
      const onDelete = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} />);
      fireEvent.click(screen.getByLabelText("Delete task"));
      fireEvent.click(screen.getByText("Cancel"));
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByText("Done")).toBeTruthy();
      expect(screen.getByLabelText("Delete task")).toBeTruthy();
    });

    it("Escape backs out of the confirmation step first, without closing the drawer", () => {
      const onDelete = vi.fn();
      const onClose = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onDelete={onDelete} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText("Delete task"));

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Done")).toBeTruthy();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("switching to a different task resets a pending delete confirmation", () => {
      const taskA = makeTask({ id: "a", title: "task a" });
      const taskB = makeTask({ id: "b", title: "task b" });
      const { rerender } = render(<TaskDetailDrawer task={taskA} {...noopHandlers} />);
      fireEvent.click(screen.getByLabelText("Delete task"));
      expect(screen.getByText("Confirm delete")).toBeTruthy();

      rerender(<TaskDetailDrawer task={taskB} {...noopHandlers} />);
      expect(screen.queryByText("Confirm delete")).toBeNull();
      expect(screen.getByText("Done")).toBeTruthy();
    });
  });

  describe("actions that stay immediate, not deferred to Done", () => {
    it("calls onAddSubtask immediately, not deferred to Done", () => {
      const onAddSubtask = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onAddSubtask={onAddSubtask} />);
      const input = screen.getByLabelText("Add a subtask");
      fireEvent.change(input, { target: { value: "buy wood" } });
      fireEvent.submit(input.closest("form")!);
      expect(onAddSubtask).toHaveBeenCalledWith("buy wood");
    });

    it("keeps the add-subtask input ready for another entry after submitting (does not lose focus/clear the form)", () => {
      const onAddSubtask = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onAddSubtask={onAddSubtask} />);
      const input = screen.getByLabelText("Add a subtask") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "buy wood" } });
      fireEvent.submit(input.closest("form")!);
      expect(input.value).toBe("");
      expect(screen.getByLabelText("Add a subtask")).toBeTruthy();
    });
  });

  describe("subtask rows (compact drawer layout)", () => {
    const subtasksTask = makeTask({
      id: "s",
      title: "build shelf",
      subtasks: [
        { id: "s1", title: "measure wall", done: true },
        { id: "s2", title: "buy wood", done: false },
        { id: "s3", title: "cut boards", done: false },
      ],
    });

    it("shows a completion summary and a progress line sized to it", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      expect(screen.getByText("1 / 3")).toBeTruthy();
    });

    it("shows no completion summary when there are no subtasks", () => {
      render(<TaskDetailDrawer task={task} {...noopHandlers} />);
      expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull();
    });

    it("groups completed subtasks below active ones regardless of their order in the data", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      const titles = screen.getAllByText(/measure wall|buy wood|cut boards/).map((el) => el.textContent);
      expect(titles).toEqual(["buy wood", "cut boards", "measure wall"]);
    });

    it("shows a completed subtask muted with strikethrough, not hidden", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      const completed = screen.getByText("measure wall");
      expect(completed.className).toContain("line-through");
      expect(completed.className).toContain("text-muted-foreground");
    });

    it("keeps completion toggling working from the compact row", () => {
      const onToggleSubtask = vi.fn();
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} onToggleSubtask={onToggleSubtask} />);
      fireEvent.click(screen.getByLabelText("Toggle buy wood"));
      expect(onToggleSubtask).toHaveBeenCalledWith("s2");
    });

    it("does not show a permanent delete control — it's revealed only via hover/focus styling", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      const deleteButton = screen.getByLabelText("Delete buy wood");
      expect(deleteButton.className).toContain("opacity-0");
      expect(deleteButton.className).toContain("group-hover:opacity-100");
      expect(deleteButton.className).toContain("group-focus-within:opacity-100");
    });

    it("clicking a subtask's title opens the Subtask Detail panel instead of an inline editor", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      expect(screen.getByTestId("subtask-detail-panel")).toBeTruthy();
      expect(screen.getByLabelText("Subtask title")).toBeTruthy();
      expect(screen.queryByLabelText("Edit buy wood")).toBeNull();
    });

    it("commits the new title via onEditSubtaskTitle on blur", () => {
      const onEditSubtaskTitle = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskTitle={onEditSubtaskTitle} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      const input = screen.getByLabelText("Subtask title");
      fireEvent.change(input, { target: { value: "buy pine wood" } });
      fireEvent.blur(input);
      expect(onEditSubtaskTitle).toHaveBeenCalledWith("s2", "buy pine wood");
    });

    it("does not call onEditSubtaskTitle when the title is unchanged", () => {
      const onEditSubtaskTitle = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskTitle={onEditSubtaskTitle} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.blur(screen.getByLabelText("Subtask title"));
      expect(onEditSubtaskTitle).not.toHaveBeenCalled();
    });

    it("commits notes via onEditSubtaskMemo on blur", () => {
      const onEditSubtaskMemo = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskMemo={onEditSubtaskMemo} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      const notes = screen.getByLabelText("Subtask notes");
      fireEvent.change(notes, { target: { value: "oak, 2x4" } });
      fireEvent.blur(notes);
      expect(onEditSubtaskMemo).toHaveBeenCalledWith("s2", "oak, 2x4");
    });

    it("closes via its own close control", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.click(screen.getByLabelText("Close subtask detail"));
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });

    it("clicking the same subtask row again closes the panel", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      // Once the panel is open, its title textarea also renders "buy wood"
      // (React seeds a textarea's initial text-node content from `value`),
      // so getByText would now match two elements — target the row's
      // button specifically instead.
      fireEvent.click(screen.getByRole("button", { name: "buy wood" }));
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });

    it("clicking a different subtask switches the panel instead of stacking a second one", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.click(screen.getByText("cut boards"));
      expect(screen.getAllByTestId("subtask-detail-panel")).toHaveLength(1);
      expect((screen.getByLabelText("Subtask title") as HTMLTextAreaElement).value).toBe("cut boards");
    });

    it("switching to a different task closes any open panel", () => {
      const { rerender } = render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      expect(screen.getByTestId("subtask-detail-panel")).toBeTruthy();

      rerender(<TaskDetailDrawer task={makeTask({ id: "other", title: "unrelated" })} {...noopHandlers} />);
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });

    it("Escape closes only the Subtask Detail panel, leaving the drawer open with buffered draft edits intact", () => {
      const onClose = vi.fn();
      const onMemoChange = vi.fn();
      const comboTask = makeTask({
        id: "combo",
        title: "build shelf",
        memo: "initial note",
        subtasks: [{ id: "s1", title: "measure wall", done: false }],
      });
      render(
        <TaskDetailDrawer task={comboTask} {...noopHandlers} onClose={onClose} onMemoChange={onMemoChange} />,
      );

      // Buffer a draft edit before opening the panel — it must survive.
      fireEvent.change(screen.getByPlaceholderText("Memo"), { target: { value: "draft edit" } });

      fireEvent.click(screen.getByText("measure wall"));
      expect(screen.getByTestId("subtask-detail-panel")).toBeTruthy();

      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(onMemoChange).not.toHaveBeenCalled();
      expect((screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value).toBe("draft edit");
    });

    it("toggling a completed subtask un-completes it", () => {
      const onToggleSubtask = vi.fn();
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} onToggleSubtask={onToggleSubtask} />);
      fireEvent.click(screen.getByLabelText("Toggle measure wall"));
      expect(onToggleSubtask).toHaveBeenCalledWith("s1");
    });

    it("deletes a subtask via its hover-revealed delete control", async () => {
      const onRemoveSubtask = vi.fn();
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} onRemoveSubtask={onRemoveSubtask} />);
      fireEvent.click(screen.getByLabelText("Delete buy wood"));
      // Deferred until the row's exit animation finishes (see
      // use-subtask-transition-classes.ts), not called synchronously on click.
      await waitFor(() => expect(onRemoveSubtask).toHaveBeenCalledWith("s2"));
    });

    it("adds several subtasks in a row with Enter, without losing focus or requiring a re-click", () => {
      const onAddSubtask = vi.fn();
      render(<TaskDetailDrawer task={task} {...noopHandlers} onAddSubtask={onAddSubtask} />);
      const input = screen.getByLabelText("Add a subtask") as HTMLInputElement;

      fireEvent.change(input, { target: { value: "first" } });
      fireEvent.submit(input.closest("form")!);
      fireEvent.change(input, { target: { value: "second" } });
      fireEvent.submit(input.closest("form")!);
      fireEvent.change(input, { target: { value: "third" } });
      fireEvent.submit(input.closest("form")!);

      expect(onAddSubtask.mock.calls.map((c) => c[0])).toEqual(["first", "second", "third"]);
      expect(input.value).toBe("");
    });

    it("gives the selected weekday and Priority/Background controls a blue-tinted selected state, distinct from their unselected styling", () => {
      const priorityTask = makeTask({
        id: "p",
        title: "priority task",
        priority: true,
        scope: { kind: "day", date: "2026-07-16" },
        repeatWeekdays: [1],
      });
      render(<TaskDetailDrawer task={priorityTask} {...noopHandlers} />);

      const priorityButton = screen.getByRole("button", { name: "Priority" });
      expect(priorityButton.className).toContain("border-brand");
      expect(priorityButton.className).toContain("text-brand");

      const backgroundButton = screen.getByRole("button", { name: "Background" });
      expect(backgroundButton.className).not.toContain("border-brand");

      const selectedWeekday = screen.getByLabelText("Repeat on Monday");
      expect(selectedWeekday.className).toContain("border-brand");
      const unselectedWeekday = screen.getByLabelText("Repeat on Tuesday");
      expect(unselectedWeekday.className).not.toContain("border-brand");
    });
  });

  describe("notes (collapsed when empty, expandable)", () => {
    it("shows a compact 'Add a note…' row instead of a textarea when memo is empty", () => {
      const emptyMemoTask = makeTask({ id: "n", title: "no notes yet" });
      render(<TaskDetailDrawer task={emptyMemoTask} {...noopHandlers} />);
      expect(screen.getByText("Add a note…")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Memo")).toBeNull();
    });

    it("expands to the textarea when the compact row is clicked", () => {
      const emptyMemoTask = makeTask({ id: "n", title: "no notes yet" });
      render(<TaskDetailDrawer task={emptyMemoTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("Add a note…"));
      expect(screen.queryByText("Add a note…")).toBeNull();
      expect(screen.getByPlaceholderText("Memo")).toBeTruthy();
    });

    it("saves the note after expanding, typing, and blurring", () => {
      const onMemoChange = vi.fn();
      const emptyMemoTask = makeTask({ id: "n", title: "no notes yet" });
      render(<TaskDetailDrawer task={emptyMemoTask} {...noopHandlers} onMemoChange={onMemoChange} />);
      fireEvent.click(screen.getByText("Add a note…"));
      const textarea = screen.getByPlaceholderText("Memo");
      fireEvent.change(textarea, { target: { value: "remember the receipt" } });
      fireEvent.blur(textarea);
      fireEvent.click(screen.getByText("Done"));
      expect(onMemoChange).toHaveBeenCalledWith("remember the receipt");
    });

    it("shows the textarea directly, already expanded, when a note already exists", () => {
      const notedTask = makeTask({ id: "n", title: "has notes", memo: "already written" });
      render(<TaskDetailDrawer task={notedTask} {...noopHandlers} />);
      expect(screen.queryByText("Add a note…")).toBeNull();
      expect((screen.getByPlaceholderText("Memo") as HTMLTextAreaElement).value).toBe(
        "already written",
      );
    });

    it("gives the Add a note icon an amber accent on hover/focus, quiet otherwise (creation semantic)", () => {
      const emptyMemoTask = makeTask({ id: "n", title: "no notes yet" });
      render(<TaskDetailDrawer task={emptyMemoTask} {...noopHandlers} />);
      const row = screen.getByText("Add a note…").closest("button")!;
      const icon = row.querySelector("svg")!;
      const classTokens = (icon.getAttribute("class") ?? "").split(/\s+/);
      expect(classTokens).toContain("group-hover:text-amber");
      expect(classTokens).not.toContain("text-amber"); // never amber unconditionally, only on hover/focus
    });
  });

  it("gives the Add a subtask icon an amber accent on hover/focus, quiet otherwise (creation semantic)", () => {
    render(<TaskDetailDrawer task={task} {...noopHandlers} />);
    const input = screen.getByLabelText("Add a subtask");
    const row = input.closest("div.group")!;
    const icon = row.querySelector("svg")!;
    expect(icon.getAttribute("class")).toContain("group-hover:text-amber");
    expect(icon.getAttribute("class")).toContain("group-focus-within:text-amber");
  });
});

describe("bucket-scoped task", () => {
  const toEat = makeCategory({ id: "cat-to-eat", name: "To Eat" });
  const toGo = makeCategory({ id: "cat-to-go", name: "To Go" });
  const bucketTask = makeTask({
    id: "bk",
    title: "try that new ramen place",
    scope: { kind: "bucket", categoryId: toEat.id },
  });

  it("hides Start, End, and Repeat", () => {
    render(<TaskDetailDrawer task={bucketTask} {...noopHandlers} />);
    expect(screen.queryByLabelText("Task time")).toBeNull();
    expect(screen.queryByLabelText("Task end time")).toBeNull();
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
  });

  it("still shows Due date, Priority, Background, Subtasks, and Notes", () => {
    render(<TaskDetailDrawer task={bucketTask} {...noopHandlers} />);
    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Priority" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Background" })).toBeTruthy();
    expect(screen.getByText("Subtasks")).toBeTruthy();
    expect(screen.getByText("Add a note…")).toBeTruthy();
  });

  it("shows the Category field and buffers edits until Done, like every other field", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskDetailDrawer
        task={bucketTask}
        {...noopHandlers}
        bucketCategories={[toEat, toGo]}
        onCategoryChange={onCategoryChange}
      />,
    );
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "To Go" } });
    fireEvent.blur(input);
    expect(onCategoryChange).not.toHaveBeenCalled(); // buffered, not committed yet

    fireEvent.click(screen.getByText("Done"));
    expect(onCategoryChange).toHaveBeenCalledWith("To Go");
  });

  it("Cancel discards an edited category without calling onCategoryChange", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskDetailDrawer
        task={bucketTask}
        {...noopHandlers}
        bucketCategories={[toEat, toGo]}
        onCategoryChange={onCategoryChange}
      />,
    );
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "To Go" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCategoryChange).not.toHaveBeenCalled();
  });
});

describe("TaskDetailDrawer promote subtask to task", () => {
  it("clicking the promote icon converts the subtask and shows an undo toast naming the promoted task", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    render(<TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));

    expect(onPromoteSubtask).toHaveBeenCalledWith("s1");
    expect(screen.getByText(/book flights/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("clicking Undo calls onUndoPromoteSubtask with the promoted task's id", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    const onUndoPromoteSubtask = vi.fn();
    render(
      <TaskDetailDrawer
        task={task}
        {...noopHandlers}
        onPromoteSubtask={onPromoteSubtask}
        onUndoPromoteSubtask={onUndoPromoteSubtask}
      />,
    );

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onUndoPromoteSubtask).toHaveBeenCalledWith("new-task");
  });

  it("does not show a toast when promotion fails (onPromoteSubtask returns undefined)", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const onPromoteSubtask = vi.fn().mockReturnValue(undefined);
    render(<TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("resets the toast when the drawer switches to a different task", () => {
    const task = makeTask({
      id: "a",
      title: "plan trip",
      subtasks: [{ id: "s1", title: "book flights", done: false }],
    });
    const otherTask = makeTask({ id: "b", title: "other task" });
    const onPromoteSubtask = vi
      .fn()
      .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
    const { rerender } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />,
    );

    fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();

    rerender(<TaskDetailDrawer task={otherTask} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("auto-dismisses the toast after 6 seconds, making the promoted row queryable again", () => {
    vi.useFakeTimers();
    try {
      const task = makeTask({
        id: "a",
        title: "plan trip",
        subtasks: [{ id: "s1", title: "book flights", done: false }],
      });
      const onPromoteSubtask = vi
        .fn()
        .mockReturnValue(makeTask({ id: "new-task", title: "book flights", done: false }));
      render(<TaskDetailDrawer task={task} {...noopHandlers} onPromoteSubtask={onPromoteSubtask} />);

      fireEvent.click(screen.getByLabelText("Move book flights out as its own task"));
      expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
