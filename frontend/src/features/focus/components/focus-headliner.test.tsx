import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeFocusRepository, makeFocusArea } from "../test-utils";
import { FocusHeadliner } from "./focus-headliner";

describe("FocusHeadliner", () => {
  it("shows one current focus and switches the shared selection", async () => {
    const agent = makeFocusArea({
      id: "agent-focus",
      title: "LangChain, RAG & AI Agents",
      description: "Build production-ready agents.",
    });
    const health = makeFocusArea({ id: "health-focus", title: "Health & Strength" });
    const repo = fakeFocusRepository({
      focusAreas: [agent, health],
      activeFocusId: agent.id,
    });

    render(<FocusHeadliner repository={repo} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "LangChain, RAG & AI Agents" })).toBeTruthy(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Switch/ })[0]!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Health & Strength" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Health & Strength" })).toBeTruthy(),
    );
    expect(repo.settings.activeFocusId).toBe(health.id);
  });

  it("keeps a single focus compact and offers direct editing", async () => {
    const focus = makeFocusArea({
      id: "only-focus",
      title: "LangChain and RAG",
      description: "",
    });
    const repo = fakeFocusRepository({ focusAreas: [focus], activeFocusId: focus.id });

    render(<FocusHeadliner repository={repo} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "LangChain and RAG" })).toBeTruthy(),
    );
    expect(screen.queryByText("1 of 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch/ })).toBeNull();
    expect(screen.getByTestId("focus-headliner").className).toContain("sm:h-16");
    expect(screen.getByTestId("focus-headliner").className).toContain("sm:mx-0");
    expect(screen.getByTestId("focus-headliner").className).toContain("sm:px-6");
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit focus" })[0]!);
    expect(screen.getByRole("dialog", { name: "Manage focus areas" })).toBeTruthy();
  });

  it("offers a deliberate empty state and creates the first focus through Manage", async () => {
    const repo = fakeFocusRepository();
    render(<FocusHeadliner repository={repo} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Choose what deserves your attention" })).toBeTruthy(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Add focus" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Add focus area" }));
    fireEvent.change(screen.getByLabelText("Focus title 1"), {
      target: { value: "Write the agent handbook" },
    });
    fireEvent.change(screen.getByLabelText("Focus description 1"), {
      target: { value: "Turn experiments into a reusable system." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save focus areas" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Write the agent handbook" })).toBeTruthy(),
    );
    expect(repo.settings.focusAreas).toHaveLength(1);
    expect(repo.settings.activeFocusId).toBe(repo.settings.focusAreas[0]!.id);
  });

  it("rolls back an optimistic focus switch when persistence fails", async () => {
    const first = makeFocusArea({ id: "one", title: "First focus" });
    const second = makeFocusArea({ id: "two", title: "Second focus" });
    const repo = fakeFocusRepository({ focusAreas: [first, second], activeFocusId: first.id });
    repo.save = async () => {
      throw new Error("offline");
    };
    render(<FocusHeadliner repository={repo} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "First focus" })).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /Switch/ })[0]!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Second focus" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("didn't save"));
    expect(screen.getByRole("heading", { name: "First focus" })).toBeTruthy();
  });
});
