import { describe, expect, it } from "vitest";
import { MAX_LOOP_LENGTH, capLoop, isLoop, itemAt, loopItems, loopLength, loopOf, mapLoops, toLoop, wrapIndex } from "./loops.ts";

describe("loops", () => {
  it("builds and reads loops", () => {
    const loop = loopOf([1, 2]);
    expect(isLoop(loop)).toBe(true);
    expect(isLoop([1, 2])).toBe(false);
    expect(isLoop({ loop: [1] })).toBe(false);
    expect(toLoop({ loop: true, items: [3] })).toEqual(loopOf([3]));
    expect(toLoop(5)).toBeUndefined();
    expect(loopItems(loop)).toEqual([1, 2]);
    expect(loopItems(7)).toEqual([7]);
  });

  it("measures broadcast length", () => {
    expect(loopLength([1, 2])).toBeUndefined();
    expect(loopLength([loopOf([1, 2, 3]), 4, loopOf([1])])).toBe(3);
    expect(loopLength([loopOf([]), loopOf([1])])).toBe(0);
  });

  it("wraps indices and broadcasts scalars", () => {
    expect(wrapIndex(5, 3)).toBe(2);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(4, 0)).toBe(0);
    expect(itemAt(loopOf(["a", "b"]), 3)).toBe("b");
    expect(itemAt(9, 5)).toBe(9);
    expect(itemAt(loopOf([]), 0)).toBeUndefined();
  });

  it("maps over loops per index", () => {
    expect(mapLoops([2, 3], ([a, b]) => (a as number) * (b as number))).toBe(6);
    expect(mapLoops([loopOf([1, 2, 3]), 10], ([a, b]) => (a as number) + (b as number))).toEqual(loopOf([11, 12, 13]));
    expect(mapLoops([loopOf([1, 2]), loopOf([10, 20, 30])], ([a, b]) => (a as number) + (b as number))).toEqual(loopOf([11, 22, 31]));
    expect(mapLoops([loopOf([]), 1], () => 0)).toEqual(loopOf([]));
  });

  it("caps long loops", () => {
    expect(MAX_LOOP_LENGTH).toBe(10_000);
    expect(capLoop([1, 2, 3], 2)).toEqual({ items: [1, 2], capped: true });
    expect(capLoop([1], 2)).toEqual({ items: [1], capped: false });
  });
});
