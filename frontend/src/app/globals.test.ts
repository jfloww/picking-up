import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "globals.css"), "utf-8");

describe("globals.css animation tokens", () => {
  const requiredStrings = [
    "--animate-fade-up:",
    "--animate-hero-demo-row:",
    "--animate-hero-demo-dot:",
    "--animate-hero-demo-title:",
    "@keyframes fade-up",
    "@keyframes hero-demo-row",
    "@keyframes hero-demo-dot",
    "@keyframes hero-demo-title",
  ];

  it.each(requiredStrings)("defines %s", (token) => {
    expect(css).toContain(token);
  });
});
