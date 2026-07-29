import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { shiftAnchor, TaskCalendar } from "./task-calendar";
import { todayKey } from "../lib/dates";
import { fakeRepository, makeTask } from "../test-utils";

describe("shiftAnchor", () => {
  it("daily pages by one day", () => {
    expect(shiftAnchor("daily", "2026-07-16", 1)).toBe("2026-07-17");
    expect(shiftAnchor("daily", "2026-07-16", -1)).toBe("2026-07-15");
  });

  it("weekly pages by exactly one week", () => {
    expect(shiftAnchor("weekly", "2026-07-16", 1)).toBe("2026-07-23");
    expect(shiftAnchor("weekly", "2026-07-16", -1)).toBe("2026-07-09");
    expect(shiftAnchor("weekly", "2026-07-31", 1)).toBe("2026-08-07"); // crosses a month
  });

  it("monthly and yearly page by year, keeping the month", () => {
    expect(shiftAnchor("monthly", "2026-07-16", 1)).toBe("2027-07-01");
    expect(shiftAnchor("yearly", "2026-07-16", -1)).toBe("2025-07-01");
  });
});

describe("TaskCalendar", () => {
  it("defaults to the Daily Focus Planner view and switches scales", async () => {
    render(<TaskCalendar repository={fakeRepository()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Daily", selected: true }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Focus Agenda")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Weekly", selected: true })).toBeTruthy(),
    );
    // Yearly is temporarily hidden from the tab bar (view-switcher.tsx's
    // VISIBLE_VIEWS) — it isn't reachable via a tab click right now, so
    // this test only exercises the tabs that still are.
  });

  describe("fixed sub-header", () => {
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, Thursday
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("shows a date label matching the current view, and keeps tabs/nav/label together as one non-shrinking block", async () => {
      render(<TaskCalendar repository={fakeRepository()} />);
      await waitFor(() => expect(screen.getByText("Week of Jul 12 – Jul 18")).toBeTruthy());

      const header = screen.getByText("Week of Jul 12 – Jul 18").closest("header");
      expect(
        header?.contains(screen.getByRole("tablist", { name: "Calendar scale" })),
      ).toBe(true);
      expect(header?.contains(screen.getByText("Today"))).toBe(true);
      expect(header?.className).toContain("shrink-0");

      expect(screen.getByText("Thursday, July 16")).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
      await waitFor(() => expect(screen.getByText("Jul 12 – Jul 18")).toBeTruthy());
      // This test only exercises Daily and Weekly; Monthly's own
      // fixed-sub-header behavior is covered separately, in monthly-view.test.tsx.
    });
  });
});

describe("drill-down navigation", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16)); // 2026-07-16, Thursday
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("double-clicking a Weekly day date switches to Daily anchored on that date", async () => {
    render(<TaskCalendar repository={fakeRepository()} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Weekly" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Go to 2026-07-14"));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Daily", selected: true })).toBeTruthy(),
    );
    expect(screen.getByText("Tuesday, July 14")).toBeTruthy();
  });
});

describe("sync error banner", () => {
  it("shows a dismissible error banner when a sync error occurs, and hides it on dismiss", async () => {
    const day = todayKey();
    const task = makeTask({ id: "a", scope: { kind: "day", date: day } });
    const repo = fakeRepository([task]);
    vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("down"));

    render(<TaskCalendar repository={repo} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
