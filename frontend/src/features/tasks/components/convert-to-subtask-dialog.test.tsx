import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConvertToSubtaskDialog } from "./convert-to-subtask-dialog";

describe("ConvertToSubtaskDialog", () => {
  it("names both tasks and lists the fields that will be lost", () => {
    render(
      <ConvertToSubtaskDialog
        sourceTitle="Buy milk"
        targetTitle="Groceries"
        lostFields={["time", "priority"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Buy milk/)).toBeTruthy();
    expect(screen.getByText(/Groceries/)).toBeTruthy();
    expect(screen.getByText(/time, priority/)).toBeTruthy();
  });

  it("calls onConfirm when Confirm is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("alertdialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the dialog card", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on Escape", () => {
    const onCancel = vi.fn();
    render(
      <ConvertToSubtaskDialog
        sourceTitle="a"
        targetTitle="b"
        lostFields={["note"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
