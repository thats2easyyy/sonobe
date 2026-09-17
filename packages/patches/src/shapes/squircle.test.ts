import { describe, expect, it } from "vitest";
import { squirclePath } from "./squircle.ts";
import type { CornerRadii } from "./squircle.ts";

// Output of packages/renderer/src/squircle.ts for the same arguments. If the renderer changes,
// regenerate these and update the mirror so Shape layers keep matching Rectangle layers.
const GOLDEN: [x: number, y: number, w: number, h: number, radii: CornerRadii, smoothing: number, path: string][] = [
  [0, 0, 100, 100, [16, 16, 16, 16], 0, "M 84 0 c 0 0 0 0 0 0 a 16 16 0 0 1 16 16 c 0 0 0 0 0 0 L 100 84 c 0 0 0 0 0 0 a 16 16 0 0 1 -16 16 c 0 0 0 0 0 0 L 16 100 c 0 0 0 0 0 0 a 16 16 0 0 1 -16 -16 c 0 0 0 0 0 0 L 0 16 c 0 0 0 0 0 0 a 16 16 0 0 1 16 -16 c 0 0 0 0 0 0 L 84 0 Z"],
  [0, 0, 100, 100, [16, 16, 16, 16], 0.6, "M 74.4 0 c 8.961 0 13.441 0 16.864 1.744 a 16 16 0 0 1 6.992 6.992 c 1.744 3.423 1.744 7.903 1.744 16.864 L 100 74.4 c 0 8.961 0 13.441 -1.744 16.864 a 16 16 0 0 1 -6.992 6.992 c -3.423 1.744 -7.903 1.744 -16.864 1.744 L 25.6 100 c -8.961 0 -13.441 0 -16.864 -1.744 a 16 16 0 0 1 -6.992 -6.992 c -1.744 -3.423 -1.744 -7.903 -1.744 -16.864 L 0 25.6 c 0 -8.961 0 -13.441 1.744 -16.864 a 16 16 0 0 1 6.992 -6.992 c 3.423 -1.744 7.903 -1.744 16.864 -1.744 L 74.4 0 Z"],
  [10, 5, 158, 46, [23, 23, 23, 23], 0, "M 145 5 c 0 0 0 0 0 0 a 23 23 0 0 1 23 23 c 0 0 0 0 0 0 L 168 28 c 0 0 0 0 0 0 a 23 23 0 0 1 -23 23 c 0 0 0 0 0 0 L 33 51 c 0 0 0 0 0 0 a 23 23 0 0 1 -23 -23 c 0 0 0 0 0 0 L 10 28 c 0 0 0 0 0 0 a 23 23 0 0 1 23 -23 c 0 0 0 0 0 0 L 145 5 Z"],
  [0, 0, 100, 40, [0, 30, 10, 0], 1, "M 70 0 c 0 0 0 0 0 0 a 30 30 0 0 1 30 30 c 0 0 0 0 0 0 L 100 30 c 0 0 0 0 0 0 a 10 10 0 0 1 -10 10 c 0 0 0 0 0 0 L 0 40 l 0 0 L 0 0 l 0 0 L 70 0 Z"],
  [-20.5, 3.25, 80, 80, [100, 100, 100, 100], 0.3, "M 19.5 3.25 c 0 0 0 0 0 0 a 40 40 0 0 1 40 40 c 0 0 0 0 0 0 L 59.5 43.25 c 0 0 0 0 0 0 a 40 40 0 0 1 -40 40 c 0 0 0 0 0 0 L 19.5 83.25 c 0 0 0 0 0 0 a 40 40 0 0 1 -40 -40 c 0 0 0 0 0 0 L -20.5 43.25 c 0 0 0 0 0 0 a 40 40 0 0 1 40 -40 c 0 0 0 0 0 0 L 19.5 3.25 Z"],
  [0, 0, 100, 100, [0, 0, 0, 0], 0, "M 100 0 l 0 0 L 100 100 l 0 0 L 0 100 l 0 0 L 0 0 l 0 0 L 100 0 Z"],
];

describe("squirclePath mirror", () => {
  it.each(GOLDEN)("matches the renderer for (%d, %d, %d × %d, %j, smoothing %d)", (x, y, w, h, radii, smoothing, path) => {
    expect(squirclePath(x, y, w, h, radii, smoothing)).toBe(path);
  });
});
