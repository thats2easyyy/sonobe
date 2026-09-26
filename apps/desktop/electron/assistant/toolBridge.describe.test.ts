import { describe, expect, it } from "vitest";
import { describeToolResult } from "./toolBridge.ts";

const text = (value: string, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

describe("describeToolResult", () => {
  it("takes the first line of a result", () => {
    expect(describeToolResult(text("revision 3\nmore\nlines"))).toBe("revision 3");
    expect(describeToolResult(text("\n  \n  revision 3  "))).toBe("revision 3");
  });

  it("drops the layer id from an import's chip", () => {
    expect(describeToolResult(text('Imported "Profile" as layer scr_8x2: 14 layers, 2 images.\nScreen outline:'))).toBe('Imported "Profile": 14 layers, 2 images.');
    expect(describeToolResult(text('Re-imported "Home" as layer home: 3 layers.'))).toBe('Re-imported "Home": 3 layers.');
  });

  it("gives a failure its message and the hint that says what to do", () => {
    const failed = text("Error UNKNOWN_LAYER (op 0, layers[1].id): No layer with id “card”.\nHint: Call get_outline to see the ids.\n  Suggestions:\n  1. Use “card-1”", true);
    expect(describeToolResult(failed)).toBe("Error UNKNOWN_LAYER (op 0, layers[1].id): No layer with id “card”. Hint: Call get_outline to see the ids.");
  });

  it("keeps a failure without a hint to its message, and clips both", () => {
    expect(describeToolResult(text("The prototype changed while you worked.", true))).toBe("The prototype changed while you worked.");
    const long = describeToolResult(text(`Error TOO_LONG: ${"a".repeat(300)}\nHint: ${"b".repeat(300)}`, true));
    const [message, hint] = long.split(" Hint: ");
    expect(message).toHaveLength(140);
    expect(message!.endsWith("…")).toBe(true);
    expect(hint!.length).toBeLessThanOrEqual(134);
  });

  it("names results with no text", () => {
    expect(describeToolResult({ content: [{ type: "image", data: "", mimeType: "image/png" }] })).toBe("Screenshot");
    expect(describeToolResult({ content: [] })).toBe("Done");
    expect(describeToolResult({ content: [], isError: true })).toBe("Failed");
  });
});
