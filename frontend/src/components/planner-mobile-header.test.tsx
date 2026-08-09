import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlannerMobileHeader } from "./planner-mobile-header";

describe("PlannerMobileHeader", () => {
  it("keeps account and appearance controls in a mobile bottom sheet", () => {
    render(<PlannerMobileHeader user={null} />);

    expect(screen.getByLabelText("Picking Up home")).toBeTruthy();
    const header = screen.getByLabelText("Picking Up home").closest("header");
    expect(header?.className).toContain("sm:hidden");

    fireEvent.click(screen.getByLabelText("Open profile and appearance menu"));
    expect(screen.getByRole("dialog", { name: "Profile and appearance" })).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Close menu"));
    expect(screen.queryByRole("dialog", { name: "Profile and appearance" })).toBeNull();
  });

  it("traps keyboard focus in the sheet and restores it to the menu trigger", () => {
    render(<PlannerMobileHeader user={null} />);
    const trigger = screen.getByLabelText("Open profile and appearance menu");
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Profile and appearance" });
    expect(document.activeElement).toBe(screen.getByLabelText("Close menu"));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Sign in"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Profile and appearance" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
