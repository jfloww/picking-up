import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { shiftAnchor, TaskCalendar } from "./task-calendar";

describe("shiftAnchor", () => {
  it("daily pages by one day", () => {
    expect(shiftAnchor("daily", "2026-07-16", 1)).toBe("2026-07-17");
    expect(shiftAnchor("daily", "2026-07-16", -1)).toBe("2026-07-15");
  });

  it("weekly pages by month to the 1st", () => {
    expect(shiftAnchor("weekly", "2026-07-16", 1)).toBe("2026-08-01");
    expect(shiftAnchor("weekly", "2026-01-16", -1)).toBe("2025-12-01");
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
    expect(screen.getByText("Su")).toBeTruthy(); // weekly grid day header

    fireEvent.click(screen.getByRole("tab", { name: "Yearly" }));
    await waitFor(() => expect(screen.getByText("January")).toBeTruthy());
  });
});
