import { describe, expect, it } from "vitest";
import { formatMeasurement, measureBetween, measureGaps, snapRect } from "./snapping.ts";

const artboard = { x: 0, y: 0, width: 400, height: 800 };

describe("snapRect", () => {
  it("snaps the nearest edge within the threshold and reports guides", () => {
    const sibling = { x: 100, y: 300, width: 80, height: 40 };
    const moving = { x: 103, y: 100, width: 50, height: 50 };
    const r = snapRect(moving, [sibling, artboard], { threshold: 5 });
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", at: 100, from: 100, to: 340 }]);
  });

  it("prefers the closest candidate across edges and centers", () => {
    // Moving center x = 198; artboard center = 200 (2 away), right edge vs sibling left = 4 away.
    const sibling = { x: 227, y: 0, width: 10, height: 10 };
    const r = snapRect({ x: 173, y: 500, width: 50, height: 20 }, [sibling, artboard], { threshold: 5 });
    expect(r.dx).toBe(2);
    expect(r.guides.some((g) => g.axis === "x" && g.at === 200)).toBe(true);
  });

  it("leaves the rect alone beyond the threshold", () => {
    const r = snapRect({ x: 30, y: 30, width: 20, height: 20 }, [{ x: 100, y: 100, width: 10, height: 10 }], { threshold: 4 });
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps only the edges a resize moves", () => {
    const target = { x: 0, y: 200, width: 100, height: 10 };
    // The left edge is 2 from target.x, but only the right (end) edge may snap: 97 → 100.
    const r = snapRect({ x: 2, y: 0, width: 95, height: 50 }, [target], { threshold: 5, edgesX: ["end"], edgesY: [] });
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]).toMatchObject({ axis: "x", at: 100 });
  });

  it("merges guides on the same line", () => {
    const a = { x: 50, y: 0, width: 10, height: 10 };
    const b = { x: 50, y: 500, width: 10, height: 10 };
    const r = snapRect({ x: 51, y: 200, width: 30, height: 20 }, [a, b], { threshold: 3, edgesY: [] });
    expect(r.guides).toEqual([{ axis: "x", at: 50, from: 0, to: 510 }]);
  });
});

describe("measureGaps", () => {
  it("measures to the nearest overlapping neighbor on each side and the container otherwise", () => {
    const rect = { x: 100, y: 100, width: 100, height: 100 };
    const left = { x: 20, y: 150, width: 40, height: 20 };
    const farLeft = { x: 0, y: 120, width: 10, height: 10 };
    const offAxis = { x: 250, y: 400, width: 10, height: 10 };
    const gaps = measureGaps(rect, [left, farLeft, offAxis], artboard);
    const byAxis = (axis: "x" | "y") => gaps.filter((g) => g.axis === axis).map((g) => g.value).sort((x, y) => x - y);
    // Left: nearest neighbor at 60 → 40; right: container 400 → 200; top: 100; bottom: 800 - 200 = 600.
    expect(byAxis("x")).toEqual([40, 200]);
    expect(byAxis("y")).toEqual([100, 600]);
    const leftGap = gaps.find((g) => g.value === 40)!;
    expect(leftGap.from).toEqual([60, 160]);
    expect(leftGap.to).toEqual([100, 160]);
  });
});

describe("measureBetween", () => {
  it("measures separation between disjoint rects", () => {
    const m = measureBetween({ x: 0, y: 0, width: 50, height: 50 }, { x: 80, y: 90, width: 20, height: 20 });
    expect(m.map((x) => [x.axis, x.value])).toEqual([["x", 30], ["y", 40]]);
  });

  it("measures inner distances when one rect contains the other", () => {
    const m = measureBetween({ x: 10, y: 20, width: 50, height: 50 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(m.map((x) => x.value).sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it("formats labels", () => {
    expect(formatMeasurement(12)).toBe("12");
    expect(formatMeasurement(12.34)).toBe("12.3");
  });
});
