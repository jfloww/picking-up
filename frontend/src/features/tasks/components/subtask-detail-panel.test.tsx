import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubtaskDetailPanel } from "./subtask-detail-panel";

const subtask = { id: "s1", title: "buy wood", done: false, memo: "oak, 2x4" };

describe("SubtaskDetailPanel", () => {
  it("shows the subtask's full title and memo", () => {
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Subtask title") as HTMLTextAreaElement).value).toBe("buy wood");
    expect((screen.getByLabelText("Subtask notes") as HTMLTextAreaElement).value).toBe("oak, 2x4");
  });

  it("renders the title as a wrapping textarea, not a single-line input that clips long text", () => {
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Subtask title").tagName).toBe("TEXTAREA");
  });

  it("commits a changed title via onTitleChange on blur", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.change(input, { target: { value: "buy pine wood" } });
    fireEvent.blur(input);
    expect(onTitleChange).toHaveBeenCalledWith("buy pine wood");
  });

  it("commits a changed title via onTitleChange on Enter", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.change(input, { target: { value: "buy pine wood" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitleChange).toHaveBeenCalledWith("buy pine wood");
  });

  it("Escape restores the original title without calling onTitleChange", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "something else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(input.value).toBe("buy wood");
  });

  it("does not call onTitleChange when the title is unchanged or blank", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it("commits the memo via onMemoChange on blur, including clearing it to empty", () => {
    const onMemoChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={onMemoChange}
      />,
    );
    const notes = screen.getByLabelText("Subtask notes");
    fireEvent.change(notes, { target: { value: "cedar instead" } });
    fireEvent.blur(notes);
    expect(onMemoChange).toHaveBeenCalledWith("cedar instead");

    fireEvent.change(notes, { target: { value: "" } });
    fireEvent.blur(notes);
    expect(onMemoChange).toHaveBeenCalledWith("");
  });

  it("calls onClose when the close control is clicked", () => {
    const onClose = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={onClose}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close subtask detail"));
    expect(onClose).toHaveBeenCalled();
  });

  it("re-syncs its fields when a different subtask is passed in", () => {
    const { rerender } = render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    rerender(
      <SubtaskDetailPanel
        subtask={{ id: "s2", title: "cut boards", done: false }}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Subtask title") as HTMLTextAreaElement).value).toBe("cut boards");
    expect((screen.getByLabelText("Subtask notes") as HTMLTextAreaElement).value).toBe("");
  });
});
