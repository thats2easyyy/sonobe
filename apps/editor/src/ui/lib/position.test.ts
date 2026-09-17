import { describe, expect, it } from "vitest";
import { computePosition, splitPlacement } from "./position.ts";

const viewport = { width: 1000, height: 800 };

describe("computePosition", () => {
  it("places below the anchor aligned to its start", () => {
    const result = computePosition({ x: 100, y: 100, width: 80, height: 24 }, { width: 200, height: 150 }, viewport);
    expect(result).toMatchObject({ x: 100, y: 130, side: "bottom", placement: "bottom-start" });
  });

  it("flips to the side with more room", () => {
    const result = computePosition({ x: 100, y: 700, width: 80, height: 24 }, { width: 200, height: 150 }, viewport);
    expect(result).toMatchObject({ side: "top", y: 544 });
  });

  it("shifts along the cross axis to stay on screen", () => {
    const result = computePosition({ x: 950, y: 100, width: 40, height: 24 }, { width: 200, height: 100 }, viewport);
    expect(result.x).toBe(792);
  });

  it("flips a submenu to the left near the right edge", () => {
    const result = computePosition({ x: 850, y: 200, width: 140, height: 26 }, { width: 180, height: 200 }, viewport, {
      placement: "right-start",
      offset: 2,
    });
    expect(result).toMatchObject({ side: "left", x: 668, y: 200, placement: "left-start" });
  });

  it("centers when no alignment is given", () => {
    const result = computePosition({ x: 400, y: 400, width: 100, height: 20 }, { width: 60, height: 30 }, viewport, { placement: "top" });
    expect(result).toMatchObject({ x: 420, y: 364, placement: "top" });
  });

  it("limits size when neither side fits", () => {
    const result = computePosition({ x: 20, y: 140, width: 100, height: 20 }, { width: 100, height: 400 }, { width: 400, height: 300 });
    expect(result).toMatchObject({ side: "bottom", maxHeight: 126, y: 166 });
  });

  it("applies a cross-axis offset", () => {
    const result = computePosition({ x: 100, y: 200, width: 140, height: 26 }, { width: 180, height: 200 }, viewport, {
      placement: "right-start",
      offset: 2,
      crossOffset: -4,
    });
    expect(result).toMatchObject({ x: 242, y: 196 });
  });

  it("can disable flipping", () => {
    const result = computePosition({ x: 100, y: 700, width: 80, height: 24 }, { width: 200, height: 150 }, viewport, { flip: false });
    expect(result.side).toBe("bottom");
  });
});

describe("splitPlacement", () => {
  it("defaults alignment to center", () => {
    expect(splitPlacement("left")).toEqual(["left", "center"]);
    expect(splitPlacement("bottom-end")).toEqual(["bottom", "end"]);
  });
});
