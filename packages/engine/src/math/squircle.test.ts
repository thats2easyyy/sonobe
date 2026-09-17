import { describe, expect, it } from "vitest";
import { squirclePath } from "../index.ts";

describe("squirclePath", () => {
  it("smoothing 0 draws circular arcs with flat blends", () => {
    expect(squirclePath(0, 0, 100, 60, [12, 12, 12, 12], 0)).toBe(
      "M 88 0 c 0 0 0 0 0 0 a 12 12 0 0 1 12 12 c 0 0 0 0 0 0 L 100 48 c 0 0 0 0 0 0 a 12 12 0 0 1 -12 12 c 0 0 0 0 0 0 L 12 60 c 0 0 0 0 0 0 a 12 12 0 0 1 -12 -12 c 0 0 0 0 0 0 L 0 12 c 0 0 0 0 0 0 a 12 12 0 0 1 12 -12 c 0 0 0 0 0 0 L 88 0 Z",
    );
  });

  it("smoothing extends each corner into the edges with cubic blends (matches the renderer's former module)", () => {
    expect(squirclePath(10, 20, 200, 120, [24, 24, 24, 24], 0.6)).toBe(
      "M 171.6 20 c 13.441 0 20.162 0 25.296 2.616 a 24 24 0 0 1 10.488 10.488 c 2.616 5.134 2.616 11.855 2.616 25.296 L 210 101.6 c 0 13.441 0 20.162 -2.616 25.296 a 24 24 0 0 1 -10.488 10.488 c -5.134 2.616 -11.855 2.616 -25.296 2.616 L 48.4 140 c -13.441 0 -20.162 0 -25.296 -2.616 a 24 24 0 0 1 -10.488 -10.488 c -2.616 -5.134 -2.616 -11.855 -2.616 -25.296 L 10 58.4 c 0 -13.441 0 -20.162 2.616 -25.296 a 24 24 0 0 1 10.488 -10.488 c 5.134 -2.616 11.855 -2.616 25.296 -2.616 L 171.6 20 Z",
    );
  });

  it("shares room between uneven corners and reduces smoothing when there isn't room", () => {
    expect(squirclePath(0, 0, 80, 40, [40, 0, 10, 60], 1)).toBe(
      "M 80 0 l 0 0 L 80 28.571 c 0 1.327 0 1.99 -0.063 2.548 a 10 10 0 0 1 -8.817 8.817 c -0.558 0.063 -1.221 0.063 -2.548 0.063 L 24 40 c 0 0 0 0 0 0 a 24 24 0 0 1 -24 -24 c 0 0 0 0 0 0 L 0 16 c 0 0 0 0 0 0 a 16 16 0 0 1 16 -16 c 0 0 0 0 0 0 L 80 0 Z",
    );
  });

  it("degenerate sizes and negative radii never produce NaN", () => {
    expect(squirclePath(0, 0, 0, 0, [5, 5, 5, 5], 0.5)).toBe("M 0 0 l 0 0 L 0 0 l 0 0 L 0 0 l 0 0 L 0 0 l 0 0 L 0 0 Z");
    const path = squirclePath(0, 0, -20, 30, [-4, 8, Number.POSITIVE_INFINITY, 2], 3);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.startsWith("M ")).toBe(true);
  });
});
