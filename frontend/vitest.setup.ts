import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cleanup after each test to ensure proper test isolation
afterEach(() => {
  cleanup();
});
