import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { TaskDetailFields } from "./task-detail-fields";

const noopHandlers = {
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};

describe("TaskDetailFields showTime", () => {
  it("shows the time input by default", () => {
    render(<TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} />);
    expect(screen.getByLabelText("Task time")).toBeTruthy();
  });

  it("skips the time input when showTime is false", () => {
    render(
      <TaskDetailFields task={makeTask({ time: "14:00" })} {...noopHandlers} showTime={false} />,
    );
    expect(screen.queryByLabelText("Task time")).toBeNull();
  });
});
