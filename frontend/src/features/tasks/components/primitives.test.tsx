import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { todayKey, weekStartOf } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { PeriodCell } from "./period-cell";
import { QuickAdd } from "./quick-add";
import { ScopeTasks } from "./scope-tasks";
import { TaskItem } from "./task-item";

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
        onToggle={onToggle}
        onMemoChange={() => {}}
        onDelete={() => {}}
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
        onToggle={() => {}}
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
  it("renders only tasks matching the scope", async () => {
    // Anchored to the current date so rolloverTasks (applied on load) never
    // moves these tasks out of the scopes under test.
    const week = weekStartOf(todayKey());
    const inScope = makeTask({
      id: "in",
      title: "in scope",
      scope: { kind: "week", weekStart: week },
    });
    const outScope = makeTask({
      id: "out",
      title: "out of scope",
      scope: { kind: "day", date: todayKey() },
    });
    render(
      <TasksProvider repository={fakeRepository([inScope, outScope])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("in scope")).toBeTruthy());
    expect(screen.queryByText("out of scope")).toBeNull();
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });
});
