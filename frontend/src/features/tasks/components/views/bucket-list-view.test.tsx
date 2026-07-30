import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeRepository, makeTask } from "../../test-utils";
import { TasksProvider } from "../../store";
import { BucketListView } from "./bucket-list-view";

function renderView(tasks = [] as ReturnType<typeof makeTask>[]) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <BucketListView anchor="2026-07-16" onAnchorChange={() => {}} />
    </TasksProvider>,
  );
}

describe("BucketListView", () => {
  it("shows the empty state when there are no bucket tasks", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("Your bucket list is empty")).toBeTruthy());
    expect(screen.getByText("Add something you want to do, try, visit, or remember.")).toBeTruthy();
  });

  it("groups tasks by category and shows item counts", async () => {
    renderView([
      makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", category: "To Go" } }),
    ]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    expect(screen.getByText("To Go")).toBeTruthy();
    expect(screen.getByText("sushi")).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });

  it("completes and un-completes an item from its row", async () => {
    renderView([makeTask({ id: "1", title: "sushi", done: false, scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByLabelText("Toggle sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).toContain("line-through"));
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).not.toContain("line-through"));
  });

  it("deletes an item from its row", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("sushi")).toBeNull());
  });

  it("removes a category's whole section once its last item is deleted, keeping other categories", async () => {
    renderView([
      makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } }),
      makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", category: "To Go" } }),
    ]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("To Eat")).toBeNull());
    expect(screen.getByText("To Go")).toBeTruthy(); // untouched
  });

  it("opens the Task Detail drawer when a row's title is clicked", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByText("sushi"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());
    expect(screen.queryByLabelText("Task time")).toBeNull(); // scheduling fields hidden
  });

  it("adds several items with Enter inside one category without losing focus", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByLabelText("Add item to To Eat")).toBeTruthy());
    const input = screen.getByLabelText("Add item to To Eat") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());

    fireEvent.change(input, { target: { value: "tacos" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("tacos")).toBeTruthy());
  });

  it("opens the general composer, creates a new category with its first item, and closes", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "To Go" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("To Go")).toBeTruthy());
    expect(screen.getByText("climb Fuji")).toBeTruthy();
    expect(screen.queryByLabelText("Item title")).toBeNull(); // composer closed
  });

  it("rejects an empty title or category without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/title is required/i)).toBeTruthy();
    expect(screen.getByLabelText("Item title")).toBeTruthy(); // composer still open

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/category is required/i)).toBeTruthy();
  });

  it("Escape closes the composer without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });

    fireEvent.keyDown(screen.getByLabelText("Item title"), { key: "Escape" });
    expect(screen.queryByLabelText("Item title")).toBeNull();
    expect(screen.queryByText("climb Fuji")).toBeNull();
  });

  it("includes a submit button in the general composer form, so a real browser's implicit Enter-to-submit isn't suppressed", async () => {
    // The composer form has two text fields (title, category) and previously
    // had no submit button. Per the HTML Standard's implicit-submission
    // algorithm, a form with more than one text field and no submit button
    // suppresses Enter-to-submit entirely in real browsers — jsdom does not
    // emulate this suppression (verified separately: fireEvent.keyDown with
    // Enter never triggers a submit in jsdom, button or no button), so the
    // meaningful, browser-accurate assertion is structural: a submit button
    // must exist in the DOM, since its mere presence is what restores
    // Enter-to-submit for every field in the form.
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    const form = screen.getByLabelText("Item title").closest("form")!;
    const submitButton = form.querySelector('button[type="submit"]');
    expect(submitButton).not.toBeNull();
  });

  it("reuses an existing category's casing when the general composer's category is a case-insensitive match", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", category: "To Eat" } })]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "ramen" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "to eat" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());
    expect(screen.getAllByText("To Eat")).toHaveLength(1); // one section, not two
    expect(screen.queryByText("to eat")).toBeNull();
  });
});
