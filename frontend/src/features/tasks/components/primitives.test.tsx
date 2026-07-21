import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addDays, shortDateLabel, todayKey, weekStartOf } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { PeriodCell } from "./period-cell";
import { QuickAdd } from "./quick-add";
import { ScopeTasks } from "./scope-tasks";
import { SubtaskList } from "./subtask-list";
import { TaskItem } from "./task-item";

const noopHandlers = {
  onToggle: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("QuickAdd", () => {
  it("submits trimmed value on Enter and clears", () => {
    const onAdd = vi.fn();
    render(<QuickAdd onAdd={onAdd} />);
    const input = screen.getByLabelText("Add task") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  ship it  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith("ship it");
    expect(input.value).toBe("");
  });
});

describe("TaskItem", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("toggles via checkbox and shows the rolled marker", () => {
    const onToggle = vi.fn();
    render(
      <TaskItem
        task={{ ...task, rolledFrom: { kind: "day", date: "2026-07-01" } }}
        {...noopHandlers}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
    expect(screen.getByLabelText("Rolled over")).toBeTruthy();
  });

  it("expands to memo + delete when the title is clicked", () => {
    const onDelete = vi.fn();
    const onMemoChange = vi.fn();
    render(
      <TaskItem
        task={task}
        {...noopHandlers}
        onMemoChange={onMemoChange}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("write tests"));
    const memo = screen.getByPlaceholderText("Memo") as HTMLTextAreaElement;
    expect(memo.value).toBe("with care");
    fireEvent.blur(memo, { target: { value: "updated" } });
    expect(onMemoChange).toHaveBeenCalledWith("updated");
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("calls onSelect instead of expanding inline when provided", () => {
    const onSelect = vi.fn();
    render(<TaskItem task={task} {...noopHandlers} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("write tests"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("Memo")).toBeNull();
  });
});

describe("TaskItem v2", () => {
  it("shows time prefix and subtask progress badge on the collapsed row", () => {
    render(
      <TaskItem
        task={makeTask({
          title: "dentist",
          time: "14:00",
          subtasks: [
            { id: "s1", title: "a", done: true },
            { id: "s2", title: "b", done: false },
          ],
        })}
        {...noopHandlers}
      />,
    );
    expect(screen.getByText("14:00")).toBeTruthy();
    expect(screen.getByLabelText("Subtasks: 1/2").textContent).toBe("1/2");
  });

  it("edits and clears the time from the expansion", () => {
    const onTimeChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist", time: "14:00" })}
        {...noopHandlers}
        onTimeChange={onTimeChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.change(screen.getByLabelText("Task time"), {
      target: { value: "15:30" },
    });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
    fireEvent.click(screen.getByText("Clear"));
    expect(onTimeChange).toHaveBeenCalledWith(undefined);
  });

  it("shows an optional date label before the time badge", () => {
    render(
      <TaskItem
        task={makeTask({ title: "dentist", time: "14:00" })}
        {...noopHandlers}
        dateLabel="Mon Jul 20"
      />,
    );
    expect(screen.getByText("Mon Jul 20")).toBeTruthy();
  });

  it("renders the subtask list in the expansion", () => {
    render(
      <TaskItem
        task={makeTask({
          title: "build shelf",
          subtasks: [{ id: "s1", title: "buy wood", done: false }],
        })}
        {...noopHandlers}
      />,
    );
    fireEvent.click(screen.getByText("build shelf"));
    expect(screen.getByText("buy wood")).toBeTruthy();
    expect(screen.getByLabelText("Add subtask")).toBeTruthy();
  });
});

describe("SubtaskList", () => {
  it("wires toggle, remove, and add", () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const onAdd = vi.fn();
    render(
      <SubtaskList
        subtasks={[{ id: "s1", title: "buy wood", done: false }]}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle buy wood"));
    expect(onToggle).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByLabelText("Delete buy wood"));
    expect(onRemove).toHaveBeenCalledWith("s1");
    const input = screen.getByLabelText("Add subtask");
    fireEvent.change(input, { target: { value: "sand it" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith("sand it");
  });
});

describe("ScopeTasks v2", () => {
  it("sorts day lists timed-first and shows prefix + badge in compact mode", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    const timed = makeTask({
      id: "t",
      title: "timed",
      time: "08:00",
      scope: { kind: "day", date: day },
      subtasks: [{ id: "s1", title: "x", done: true }],
    });
    render(
      <TasksProvider repository={fakeRepository([untimed, timed])}>
        <ScopeTasks scope={{ kind: "day", date: day }} compact />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText(/08:00/)).toBeTruthy());
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("08:00");
    expect(items[0]).toContain("1/1");
    expect(items[1]).toContain("untimed");
  });
});

describe("PeriodCell", () => {
  it("calls onFocus when faded and clicked", () => {
    const onFocus = vi.fn();
    render(
      <PeriodCell focused={false} onFocus={onFocus} label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onFocus).toHaveBeenCalled();
  });

  it("is not a button when focused", () => {
    render(
      <PeriodCell focused label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ScopeTasks", () => {
  it("renders week-level tasks; a day task from a different week is excluded", async () => {
    const week = weekStartOf(todayKey());
    const inScope = makeTask({
      id: "in",
      title: "in scope",
      scope: { kind: "week", weekStart: week },
    });
    const outOfWeek = makeTask({
      id: "out",
      title: "out of scope",
      // A future date in next week: genuinely outside the target week, and
      // not in the past, so rolloverTasks (which runs on load) leaves it
      // alone instead of folding it into the current week's scope.
      scope: { kind: "day", date: addDays(week, 7) },
    });
    render(
      <TasksProvider repository={fakeRepository([inScope, outOfWeek])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("in scope")).toBeTruthy());
    expect(screen.queryByText("out of scope")).toBeNull();
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });
});

describe("ScopeTasks weekly rollup", () => {
  it("includes an unfinished day task from the week, with a date label", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("day task")).toBeTruthy());
    expect(screen.getByText(shortDateLabel(future, todayKey()))).toBeTruthy();
  });

  it("excludes a done day task from the week", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const doneTask = makeTask({
      id: "d",
      title: "done task",
      done: true,
      scope: { kind: "day", date: future },
    });
    render(
      <TasksProvider repository={fakeRepository([doneTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("done task")).toBeNull();
  });

  it("includes the day task in compact mode without a date label", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} compact />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText(/day task/)).toBeTruthy());
    expect(screen.queryByText(shortDateLabel(future, todayKey()))).toBeNull();
  });

  it("excludes a day-scoped task dated excludeDate", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const dayTask = makeTask({ id: "d", title: "day task", scope: { kind: "day", date: future } });
    render(
      <TasksProvider repository={fakeRepository([dayTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd excludeDate={future} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByText("day task")).toBeNull();
  });

  it("keeps a week-scoped task rolled over from excludeDate", async () => {
    const week = weekStartOf(todayKey());
    const future = addDays(week, 2);
    const rolledTask = makeTask({
      id: "w",
      title: "rolled task",
      scope: { kind: "week", weekStart: week },
      rolledFrom: { kind: "day", date: future },
    });
    render(
      <TasksProvider repository={fakeRepository([rolledTask])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} excludeDate={future} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("rolled task")).toBeTruthy());
  });
});
