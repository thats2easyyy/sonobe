import { describe, expect, it } from "vitest";
import { gestureDocument } from "./gestureDocument.ts";

describe("gestureDocument", () => {
  const live = { revision: 3 };
  const deferred = { revision: 2 };
  const settled = { revision: 1 };

  it("shows the current document when no gesture is open", () => {
    expect(gestureDocument(live, deferred, settled, false, false)).toBe(live);
    expect(gestureDocument(live, deferred, settled, false, true)).toBe(live);
  });

  it("follows a gesture at low priority on small graphs", () => {
    expect(gestureDocument(live, deferred, settled, true, false)).toBe(deferred);
  });

  it("holds a large graph at the document the gesture began from", () => {
    expect(gestureDocument(live, deferred, settled, true, true)).toBe(settled);
  });
});
