import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShrinkStack } from "./shrink-stack";

describe("ShrinkStack", () => {
  it("bounds the primary pane between its min and max height", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={288}
        primaryMaxHeight={576}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    expect(primary.style.minHeight).toBe("288px");
    expect(primary.style.maxHeight).toBe("576px");
  });

  it("caps the secondary pane to the space remaining above the primary's floor", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={288}
        primaryMaxHeight={576}
        secondary={<div>Secondary content</div>}
        gap={6}
      />,
    );
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(secondary.style.maxHeight).toBe("calc(100% - 294px)");
  });

  it("defaults gap to 6px when not provided", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    expect(screen.getByTestId("shrink-stack-secondary").style.maxHeight).toBe(
      "calc(100% - 106px)",
    );
  });

  it("renders the primary and secondary content passed in", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    expect(screen.getByText("Primary content")).toBeTruthy();
    expect(screen.getByText("Secondary content")).toBeTruthy();
  });

  it("renders secondary before primary when secondaryFirst is set", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
        secondaryFirst
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(
      secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps primary before secondary when secondaryFirst is not set", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={100}
        primaryMaxHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    const secondary = screen.getByTestId("shrink-stack-secondary");
    expect(
      primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("omits maxHeight on the primary pane when primaryMaxHeight is not provided", () => {
    render(
      <ShrinkStack
        primary={<div>Primary content</div>}
        primaryMinHeight={200}
        secondary={<div>Secondary content</div>}
      />,
    );
    const primary = screen.getByTestId("shrink-stack-primary");
    expect(primary.style.minHeight).toBe("200px");
    expect(primary.style.maxHeight).toBe("");
  });
});
