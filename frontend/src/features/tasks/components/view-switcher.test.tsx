import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ViewSwitcher } from "./view-switcher";

const noopHandlers = {
  onViewChange: () => {},
  onPrev: () => {},
  onNext: () => {},
  onToday: () => {},
};

describe("ViewSwitcher Prev/Today/Next cluster", () => {
  it.each(["daily", "weekly", "monthly"] as const)(
    "shows Prev/Today/Next on the %s view",
    (view) => {
      render(<ViewSwitcher view={view} {...noopHandlers} />);
      expect(screen.getByLabelText("Previous")).toBeTruthy();
      expect(screen.getByText("Today")).toBeTruthy();
      expect(screen.getByLabelText("Next")).toBeTruthy();
    },
  );

  it("hides Prev/Today/Next on the Bucket List view, since there's no anchor date to page through", () => {
    render(<ViewSwitcher view="bucket" {...noopHandlers} />);
    expect(screen.queryByLabelText("Previous")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByLabelText("Next")).toBeNull();
  });
});
