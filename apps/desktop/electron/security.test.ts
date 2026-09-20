import { describe, expect, it } from "vitest";
import { isAllowedSubframeUrl } from "./security.ts";

describe("isAllowedSubframeUrl", () => {
  it("allows only inline documents in subframes", () => {
    expect(isAllowedSubframeUrl("about:srcdoc")).toBe(true);
    expect(isAllowedSubframeUrl("about:blank")).toBe(true);
    expect(isAllowedSubframeUrl("about:blank#x")).toBe(true);
  });

  it("refuses the web, local servers, files and script URLs", () => {
    for (const url of [
      "https://example.com/",
      "http://example.com/",
      "http://localhost:5173/",
      "http://127.0.0.1:4318/mcp",
      "data:text/html,<p>hi</p>",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "blob:https://example.com/5b1c",
      "about:srcdoc#x",
      "about:blankx",
      "",
    ]) {
      expect(isAllowedSubframeUrl(url), url).toBe(false);
    }
  });
});
