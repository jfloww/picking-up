import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
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
    expect(drawer.className).toContain("w-[400px]");
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

  it("removes its Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TaskDetailDrawer task={task} {...noopHandlers} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a time input in the header and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task time")).toHaveLength(1);
  });

  it("shows a duration select in the header, next to the time, and doesn't duplicate it below", () => {
    const timedTask = makeTask({ id: "a", title: "write tests", time: "14:00" });
    render(<TaskDetailDrawer task={timedTask} {...noopHandlers} />);
    expect(screen.getAllByLabelText("Task duration")).toHaveLength(1);
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
      fireEvent.change(screen.getByLabelText("Task duration"), { target: { value: "45" } });
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
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
      fireEvent.change(screen.getByLabelText("Task duration"), { target: { value: "45" } });
      fireEvent.change(screen.getByLabelText("Task time"), { target: { value: "10:30" } });
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
      const input = screen.getByLabelText("Add subtask");
      fireEvent.change(input, { target: { value: "buy wood" } });
      fireEvent.submit(input.closest("form")!);
      expect(onAddSubtask).toHaveBeenCalledWith("buy wood");
    });
  });
});
