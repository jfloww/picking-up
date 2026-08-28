import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskItem, taskItemHandlers } from "./task-item";
import { makeTask } from "../test-utils";

const noopHandlers = {
  onToggle: () => {},
  onMemoChange: () => {},
  onTimeChange: () => {},
  onRepeatWeekdaysChange: () => {},
  onDetachFromRoutine: () => {},
  onPriorityChange: () => {},
  onDurationChange: () => {},
  onBackgroundChange: () => {},
  onDueDateChange: () => {},
  onDelete: () => {},
  onAddSubtask: () => {},
  onToggleSubtask: () => {},
  onRemoveSubtask: () => {},
};

describe('TaskItem size="week"', () => {
  it("can yield list-item ownership to a parent drag wrapper", () => {
    const { container } = render(
      <TaskItem task={makeTask()} size="week" rootElement="div" {...noopHandlers} />,
    );

    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.querySelector("li")).toBeNull();
  });

  it("collapses to a single line when the task has no time, subtasks, or repeat", () => {
    const task = makeTask({ title: "buy milk" });
    const { container } = render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("buy milk")).toBeTruthy();
    expect(screen.queryByLabelText(/Subtasks:/)).toBeNull();
    // The week card's container uses this exact class pairing; the
    // default branch's non-large container is "rounded-md" with no
    // "bg-muted", so this fails if size="week" falls through to default.
    expect(container.querySelector(".rounded-lg.bg-muted")).toBeTruthy();
  });

  it("shows a metadata line with time and subtask count when present", () => {
    const task = makeTask({
      title: "team sync",
      time: "09:00",
      subtasks: [{ id: "s1", title: "agenda", done: false }],
    });
    render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("team sync")).toBeTruthy();
    expect(screen.getByText("9:00 AM")).toBeTruthy();
    expect(screen.getByLabelText("Subtasks: 0/1")).toBeTruthy();
    // Only the week branch's hasMeta layout puts the title on its own
    // line below the metadata row ("mt-1 block w-full"); the default
    // branch's title button never carries "mt-1".
    expect(screen.getByText("team sync").className).toContain("mt-1");
  });

  it("shows the repeat cadence label next to the checkbox when provided", () => {
    const task = makeTask({ title: "gym" });
    render(<TaskItem task={task} size="week" repeatLabel="Mo/We/Fr" {...noopHandlers} />);
    expect(screen.getByText("Mo/We/Fr")).toBeTruthy();
    // week's checkbox is sized down to 13px; the default branch's
    // non-large checkbox has no explicit size override.
    expect(screen.getByLabelText("Toggle gym").className).toContain("size-[13px]");
  });

  it("calls onSelect when the title is clicked", () => {
    const task = makeTask({ title: "call dentist" });
    const onSelect = vi.fn();
    const { container } = render(
      <TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />,
    );
    fireEvent.click(screen.getByText("call dentist"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".rounded-lg.bg-muted")).toBeTruthy();
  });

  // The week card is small enough that most of its surface isn't the title:
  // the metadata row, the padding, and the empty space beside a short title
  // all used to swallow clicks, so opening details meant hitting the one-line
  // title exactly. The whole card is the click target now — matching the
  // timeline and large branches, which have always selected from the card.
  it("calls onSelect when the metadata row is clicked", () => {
    const task = makeTask({
      title: "call dentist",
      time: "09:00",
      subtasks: [{ id: "s1", title: "find number", done: false }],
    });
    const onSelect = vi.fn();
    render(<TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />);

    fireEvent.click(screen.getByText("9:00 AM"));
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Subtasks: 0/1"));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("calls onSelect when the card's empty space is clicked", () => {
    const task = makeTask({ title: "call dentist" });
    const onSelect = vi.fn();
    const { container } = render(
      <TaskItem task={task} size="week" onSelect={onSelect} {...noopHandlers} />,
    );

    const card = container.querySelector(".rounded-lg.bg-muted") as HTMLElement;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(card.className).toContain("cursor-pointer");
  });

  it("toggles from the card's checkbox without also opening details", () => {
    const task = makeTask({ title: "gym", time: "09:00" });
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(
      <TaskItem
        task={task}
        size="week"
        onSelect={onSelect}
        {...noopHandlers}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText("Toggle gym"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("strikes through the title and dims the card for a done task", () => {
    const task = makeTask({ title: "done thing", done: true });
    const { container } = render(<TaskItem task={task} size="week" {...noopHandlers} />);
    expect(screen.getByText("done thing").className).toContain("line-through");
    // Card-level "opacity-55" dimming on done is unique to the week
    // branch; the default branch's non-large container never dims on
    // task.done (only "large" does, via a different class/value).
    expect(container.querySelector(".opacity-55")).toBeTruthy();
  });

  it("shows the destructive border/background treatment for highlight=\"overdue\"", () => {
    const task = makeTask({ title: "overdue thing" });
    const { container } = render(
      <TaskItem task={task} size="week" highlight="overdue" {...noopHandlers} />,
    );
    const card = container.querySelector(".rounded-lg");
    expect(card?.className).toContain("border-destructive");
    expect(card?.className).toContain("bg-destructive/10");
    // The highlight background must win over the card's base "bg-muted",
    // not just be appended alongside it (cn()/twMerge dedupes conflicting
    // background-color utilities, keeping only the last one).
    expect(card?.className).not.toContain("bg-muted");
  });

  it("shows the warning border/background treatment for highlight=\"pending\"", () => {
    const task = makeTask({ title: "pending thing" });
    const { container } = render(
      <TaskItem task={task} size="week" highlight="pending" {...noopHandlers} />,
    );
    const card = container.querySelector(".rounded-lg");
    expect(card?.className).toContain("border-warning");
    expect(card?.className).toContain("bg-warning/10");
    expect(card?.className).not.toContain("bg-muted");
  });

  it("drops the due-date, priority, background and rolled-over badges the default size shows", () => {
    // Pinning test for a confirmed product decision, not an oversight: the
    // week card's content is deliberately limited to handle, checkbox,
    // repeat cadence, time, subtask count and title (see the "Card layout"
    // section of docs/superpowers/specs/2026-08-04-weekly-drag-handle-design.md).
    // Every badge below renders in the default size for this same task, so
    // if the week branch ever starts falling through to the default layout —
    // or drops any *more* of its content — that becomes an explicit choice
    // someone has to make here rather than a silent change.
    const task = makeTask({
      title: "loaded task",
      dueDate: "2020-01-01", // long past due
      priority: true,
      background: true,
      rolledFrom: { kind: "day", date: "2020-01-01" },
    });
    const { container: weekCard } = render(
      <TaskItem task={task} size="week" {...noopHandlers} />,
    );
    expect(weekCard.textContent).toContain("loaded task");
    expect(weekCard.textContent).not.toMatch(/Due /);
    expect(weekCard.textContent).not.toContain("Priority");
    expect(weekCard.textContent).not.toContain("Background");
    expect(weekCard.querySelector('[aria-label="Rolled over"]')).toBeNull();

    // The same task at the default size does render all four, so the
    // assertions above are about the week layout, not about the fixture.
    const { container: defaultCard } = render(<TaskItem task={task} {...noopHandlers} />);
    expect(defaultCard.textContent).toMatch(/Due /);
    expect(defaultCard.textContent).toContain("Priority");
    expect(defaultCard.textContent).toContain("Background");
    expect(defaultCard.querySelector('[aria-label="Rolled over"]')).toBeTruthy();
  });

  it("shows no highlight treatment when highlight is unset", () => {
    const task = makeTask({ title: "plain thing" });
    const { container } = render(<TaskItem task={task} size="week" {...noopHandlers} />);
    const card = container.querySelector(".rounded-lg");
    expect(card?.className).toContain("bg-muted");
    expect(card?.className).not.toContain("border-destructive");
    expect(card?.className).not.toContain("border-warning");
  });
});

describe("taskItemHandlers", () => {
  it("wires the detail drawer's scheduled-date fallback to rescheduleTaskToDay", () => {
    const rescheduleTaskToDay = vi.fn();
    const handlers = taskItemHandlers("parent-id", {
      toggleTask: () => {},
      setMemo: () => {},
      setTitle: () => {},
      setTime: () => {},
      setRepeatWeekdays: () => {},
      detachFromRoutine: () => {},
      rescheduleTaskToDay,
      setPriority: () => {},
      setDuration: () => {},
      setBackground: () => {},
      setDueDate: () => {},
      removeTask: () => {},
      addSubtask: () => {},
      toggleSubtask: () => {},
      removeSubtask: () => {},
      reorderSubtask: () => {},
      editSubtaskTitle: () => {},
      editSubtaskMemo: () => {},
      promoteSubtaskToTask: () => undefined,
      convertTaskToSubtask: () => {},
      setCategory: () => {},
      createCategory: async () => undefined,
    });

    handlers.onScheduledDateChange?.("2026-07-18");
    expect(rescheduleTaskToDay).toHaveBeenCalledWith("parent-id", "2026-07-18");
  });

  it("undoing a promotion confirms data loss so it never re-shows the nest confirmation dialog", () => {
    // PR#52 review finding: this used to call convertTaskToSubtask with no
    // third argument, defaulting confirmDataLoss to false. That silently
    // broke Undo for any promoted subtask that had been done (completedAt
    // is a lossy field the server rejects without confirmation) — the
    // click would fail with a generic sync error instead of undoing.
    const convertTaskToSubtask = vi.fn();
    const handlers = taskItemHandlers("parent-id", {
      toggleTask: () => {},
      setMemo: () => {},
      setTitle: () => {},
      setTime: () => {},
      setRepeatWeekdays: () => {},
      detachFromRoutine: () => {},
      setPriority: () => {},
      setDuration: () => {},
      setBackground: () => {},
      setDueDate: () => {},
      removeTask: () => {},
      addSubtask: () => {},
      toggleSubtask: () => {},
      removeSubtask: () => {},
      reorderSubtask: () => {},
      editSubtaskTitle: () => {},
      editSubtaskMemo: () => {},
      promoteSubtaskToTask: () => undefined,
      convertTaskToSubtask,
      setCategory: () => {},
      createCategory: async () => undefined,
    });

    handlers.onUndoPromoteSubtask("promoted-task-id");

    expect(convertTaskToSubtask).toHaveBeenCalledWith("promoted-task-id", "parent-id", true);
  });
});
