import { describe, expect, it } from "vitest";

import { firstLinkIn } from "./links";

describe("firstLinkIn", () => {
  it("returns a title that is nothing but a URL", () => {
    expect(firstLinkIn("https://bestbrilliance.com/products/ring")).toBe(
      "https://bestbrilliance.com/products/ring",
    );
  });

  it("finds a URL embedded in surrounding text", () => {
    expect(firstLinkIn("compare price at https://rarecarat.com/c/x first")).toBe(
      "https://rarecarat.com/c/x",
    );
  });

  it("returns the first URL when a title holds several", () => {
    expect(firstLinkIn("http://a.example.com and https://b.example.com")).toBe(
      "http://a.example.com/",
    );
  });

  it("ignores sentence punctuation stuck to the end", () => {
    expect(firstLinkIn("see https://example.com/a.")).toBe("https://example.com/a");
    expect(firstLinkIn("(https://example.com/a)")).toBe("https://example.com/a");
  });

  it("keeps brackets that belong to the URL itself", () => {
    expect(firstLinkIn("https://en.wikipedia.org/wiki/Ring_(jewellery)")).toBe(
      "https://en.wikipedia.org/wiki/Ring_(jewellery)",
    );
  });

  it("returns undefined for a title with no URL", () => {
    expect(firstLinkIn("Ring")).toBeUndefined();
    expect(firstLinkIn("")).toBeUndefined();
  });

  it("refuses non-http(s) schemes, including javascript:", () => {
    expect(firstLinkIn("javascript:alert(1)")).toBeUndefined();
    expect(firstLinkIn("mailto:someone@example.com")).toBeUndefined();
    expect(firstLinkIn("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("does not treat a bare domain as a link", () => {
    expect(firstLinkIn("rarecarat.com/c/x")).toBeUndefined();
  });
});
