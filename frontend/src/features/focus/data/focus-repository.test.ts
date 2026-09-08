import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiFocusRepository } from "./focus-repository";
import type { FocusSettings } from "../types";

const settings: FocusSettings = {
  focusAreas: [
    {
      id: "8b9c80d7-52e5-46cf-9856-08421626fe49",
      title: "LangChain, RAG & AI Agents",
      description: "Build production-ready agents.",
      archived: false,
    },
  ],
  activeFocusId: "8b9c80d7-52e5-46cf-9856-08421626fe49",
};

afterEach(() => vi.unstubAllGlobals());

describe("createApiFocusRepository", () => {
  it("loads settings through the authenticated Next.js proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(settings), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiFocusRepository().load()).resolves.toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith("/api/focus-settings");
  });

  it("saves the complete ordered collection and active selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(settings), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createApiFocusRepository().save(settings);

    expect(fetchMock).toHaveBeenCalledWith("/api/focus-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  });
});
