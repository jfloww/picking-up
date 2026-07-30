import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskCategoryEditor } from "./task-category-editor";

describe("TaskCategoryEditor", () => {
  it("shows the current category as the input's value", () => {
    render(<TaskCategoryEditor category="To Eat" categories={["To Eat", "To Go"]} onCategoryChange={() => {}} />);
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("To Eat");
  });

  it("suggests existing categories via a datalist, not a hard cap", () => {
    render(<TaskCategoryEditor category="To Eat" categories={["To Eat", "To Go"]} onCategoryChange={() => {}} />);
    const input = screen.getByLabelText("Category") as HTMLInputElement;
    const datalist = document.getElementById(input.list!.id) as HTMLDataListElement;
    const options = Array.from(datalist.options).map((o) => o.value);
    expect(options).toEqual(["To Eat", "To Go"]);
  });

  it("commits a trimmed value on blur, not on every keystroke", () => {
    const onCategoryChange = vi.fn();
    render(<TaskCategoryEditor category="To Eat" categories={[]} onCategoryChange={onCategoryChange} />);
    const input = screen.getByLabelText("Category");
    fireEvent.change(input, { target: { value: "  To Read  " } });
    expect(onCategoryChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCategoryChange).toHaveBeenCalledWith("To Read");
  });

  it("caps the input at 60 characters, matching the backend's scope_value limit", () => {
    render(<TaskCategoryEditor category="To Eat" categories={[]} onCategoryChange={() => {}} />);
    expect((screen.getByLabelText("Category") as HTMLInputElement).maxLength).toBe(60);
  });

  it("does not call onCategoryChange on blur when the value is unchanged", () => {
    const onCategoryChange = vi.fn();
    render(<TaskCategoryEditor category="To Eat" categories={[]} onCategoryChange={onCategoryChange} />);
    fireEvent.blur(screen.getByLabelText("Category"));
    expect(onCategoryChange).not.toHaveBeenCalled();
  });
});
