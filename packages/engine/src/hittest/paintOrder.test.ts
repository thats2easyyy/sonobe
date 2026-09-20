import { describe, expect, it } from "vitest";
import { paintIndices, paintOrder, stackDepth, type Stackable } from "./paintOrder.ts";

const node = (key: string, zPosition?: number): Stackable & { key: string } => ({ key, zPosition });
const keys = (nodes: readonly { key: string }[]) => nodes.map((n) => n.key);

describe("paintOrder", () => {
  it("returns the same array when nothing is lifted or the depths already ascend", () => {
    const flat = [node("a"), node("b", 0), node("c")];
    expect(paintOrder(flat)).toBe(flat);
    expect(paintIndices(flat)).toBeNull();
    const ascending = [node("a", -1), node("b", 0), node("c", 0), node("d", 3)];
    expect(paintOrder(ascending)).toBe(ascending);
    const single = [node("a", 5)];
    expect(paintOrder(single)).toBe(single);
    expect(paintOrder([])).toEqual([]);
  });

  it("sorts back to front by zPosition and keeps document order for ties", () => {
    const nodes = [node("a", 10), node("b"), node("c", 0), node("d", -2), node("e", 10)];
    expect(keys(paintOrder(nodes))).toEqual(["d", "b", "c", "a", "e"]);
    expect(paintIndices(nodes)).toEqual([3, 1, 2, 0, 4]);
  });

  it("puts the first loop copy in front when zPosition is index × −1", () => {
    const copies = [0, 1, 2, 3].map((i) => node(`card#${i}`, -i));
    expect(keys(paintOrder(copies))).toEqual(["card#3", "card#2", "card#1", "card#0"]);
  });

  it("counts NaN, Infinity and non-numbers as 0", () => {
    expect(stackDepth(node("a", Number.NaN))).toBe(0);
    expect(stackDepth(node("a", Number.POSITIVE_INFINITY))).toBe(0);
    expect(stackDepth({ props: { zPosition: "3" } })).toBe(0);
    const nodes = [node("a", Number.NaN), node("b", -1), node("c", Number.NEGATIVE_INFINITY)];
    expect(keys(paintOrder(nodes))).toEqual(["b", "a", "c"]);
  });

  it("reads node.zPosition before props.zPosition", () => {
    expect(stackDepth({ zPosition: 2, props: { zPosition: 9 } })).toBe(2);
    expect(stackDepth({ props: { zPosition: 9 } })).toBe(9);
    const handBuilt = [
      { key: "a", props: { zPosition: 1 } },
      { key: "b", props: {} },
    ];
    expect(keys(paintOrder(handBuilt))).toEqual(["b", "a"]);
  });
});
