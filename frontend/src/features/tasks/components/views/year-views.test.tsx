import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { YearlyView } from "./yearly-view";

const ANCHOR = "2026-07-16";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, matches the fixtures
});
afterAll(() => {
  vi.useRealTimers();
});

describe("YearlyView", () => {
  it("renders all months without fading and a Yearly side cell", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <YearlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("Yearly")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: /^Focus/ })).toHaveLength(0);
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });
});
