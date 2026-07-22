import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { shiftAnchor, TaskCalendar } from "./task-calendar";

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
  it("defaults to the weekly view and switches scales", async () => {
    render(<TaskCalendar />);
    // "Weekly"/"Yearly" appear both as tab labels and grid headers, so query
    // tabs by role and assert view content via text unique to each view.
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Weekly", selected: true }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("This Week")).toBeTruthy(); // weekly hero box

    fireEvent.click(screen.getByRole("tab", { name: "Yearly" }));
    await waitFor(() => expect(screen.getByText("January")).toBeTruthy());
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
      render(<TaskCalendar />);
      await waitFor(() => expect(screen.getByText("Jul 12 – Jul 18")).toBeTruthy());

      const header = screen.getByText("Jul 12 – Jul 18").parentElement;
      expect(
        header?.contains(screen.getByRole("tablist", { name: "Calendar scale" })),
      ).toBe(true);
      expect(header?.contains(screen.getByText("Today"))).toBe(true);
      expect(header?.className).toContain("shrink-0");

      fireEvent.click(screen.getByRole("tab", { name: "Daily" }));
      await waitFor(() =>
        expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
      await waitFor(() => expect(screen.getByText("2026")).toBeTruthy());
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
    render(<TaskCalendar />);
    await waitFor(() => expect(screen.getByLabelText("Go to 2026-07-14")).toBeTruthy());
    fireEvent.doubleClick(screen.getByLabelText("Go to 2026-07-14"));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Daily", selected: true })).toBeTruthy(),
    );
    expect(screen.getByText("Tuesday, July 14")).toBeTruthy();
  });

  it("double-clicking a Monthly month cell switches to Weekly anchored on that month's first week", async () => {
    render(<TaskCalendar />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Monthly" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Focus March" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Weekly", selected: true })).toBeTruthy(),
    );
    // 2026-03-01 is a Sunday, so its own week starts on itself.
    expect(screen.getByText("Mar 1 – Mar 7")).toBeTruthy();
  });
});
