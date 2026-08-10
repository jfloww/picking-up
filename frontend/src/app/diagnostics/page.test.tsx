import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DiagnosticsPage from "./page";
import packageJson from "../../../package.json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DiagnosticsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows the frontend and backend version, commit, and environment side by side", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a84c20fdeadbeef1234567890abcdef12345678");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "ok",
          service: "picking-up-api",
          version: "0.1.0",
          commit: "1a2b3c4deadbeef1234567890abcdef12345678",
          environment: "production",
        }),
      ),
    );

    render(await DiagnosticsPage());

    expect(screen.getByText(`${packageJson.version} (a84c20f)`)).toBeTruthy();
    expect(screen.getByText("0.1.0 (1a2b3c4) · production")).toBeTruthy();
  });

  it("shows an unavailable message when the backend cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Backend down." }, 502)),
    );

    render(await DiagnosticsPage());

    expect(screen.getByText(/unavailable — Backend down\./)).toBeTruthy();
  });
});
