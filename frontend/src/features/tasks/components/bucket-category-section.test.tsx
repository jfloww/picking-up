import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { BucketCategorySection } from "./bucket-category-section";

describe("BucketCategorySection", () => {
  const active = [makeTask({ id: "a1", title: "sushi", done: false })];
  const completed = [makeTask({ id: "c1", title: "ramen", done: true })];

  it("shows the category name and an item count", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("To Eat")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("uses singular '1 item' for exactly one item", () => {
    render(
      <BucketCategorySection
        category="To Go"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("renders active items before completed items", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const titles = screen.getAllByText(/sushi|ramen/).map((el) => el.textContent);
    expect(titles).toEqual(["sushi", "ramen"]);
  });

  it("shows a completed item muted with strikethrough, not hidden", () => {
    render(
      <BucketCategorySection
        category="To Eat"
        active={[]}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const title = screen.getByText("ramen");
    expect(title.className).toContain("line-through");
    expect(title.className).toContain("text-muted-foreground");
  });

  it("calls onToggle when a row's checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={onToggle}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    expect(onToggle).toHaveBeenCalledWith("a1");
  });

  it("calls onSelect when a row's title is clicked", () => {
    const onSelect = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={onSelect}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("sushi"));
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("calls onDelete from the row's hover-revealed delete control", () => {
    const onDelete = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={onDelete}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("shows a due-date badge when present, turning destructive when overdue and not done", () => {
    const overdue = [
      makeTask({ id: "o1", title: "renew passport", done: false, dueDate: "2020-01-01" }),
    ];
    render(
      <BucketCategorySection
        category="To Do"
        active={overdue}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const badge = screen.getByText(/Due/);
    expect(badge.className).toContain("text-destructive");
  });

  it("shows a Priority badge when present", () => {
    const priority = [makeTask({ id: "p1", title: "climb Fuji", priority: true })];
    render(
      <BucketCategorySection
        category="To Go"
        active={priority}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("has a per-category add-item row that calls onAddItem with the typed title", () => {
    const onAddItem = vi.fn();
    render(
      <BucketCategorySection
        category="To Eat"
        active={[]}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={onAddItem}
      />,
    );
    const input = screen.getByLabelText("Add item to To Eat");
    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAddItem).toHaveBeenCalledWith("ramen");
    expect((input as HTMLInputElement).value).toBe(""); // ready for the next entry
  });
});
