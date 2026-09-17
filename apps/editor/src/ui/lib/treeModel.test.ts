import { describe, expect, it } from "vitest";
import {
  findTreeNode,
  flattenTree,
  getAncestorIds,
  moveTreeNodes,
  placementFromOffset,
  resolveDropTarget,
} from "./treeModel.ts";

interface Node {
  id: string;
  children?: Node[];
}

const withChildren = (node: Node, children: Node[]): Node => ({ ...node, children });

const makeTree = (): Node[] => [
  { id: "status_bar" },
  { id: "card", children: [{ id: "photo" }, { id: "title" }, { id: "subtitle" }] },
  { id: "tab_bar", children: [{ id: "tab_home" }, { id: "tab_search" }] },
  { id: "empty_group", children: [] },
];

const ids = (nodes: readonly Node[]): unknown =>
  nodes.map((n) => (n.children ? { [n.id]: ids(n.children) } : n.id));

describe("flattenTree", () => {
  it("shows children only for expanded nodes", () => {
    const tree = makeTree();
    expect(flattenTree(tree, new Set()).map((r) => r.id)).toEqual(["status_bar", "card", "tab_bar", "empty_group"]);
    const rows = flattenTree(tree, new Set(["card", "empty_group"]));
    expect(rows.map((r) => r.id)).toEqual(["status_bar", "card", "photo", "title", "subtitle", "tab_bar", "empty_group"]);
    expect(rows[3]).toMatchObject({ depth: 1, parentId: "card", index: 1, setSize: 3, hasChildren: false });
    expect(rows[1]).toMatchObject({ hasChildren: true, expanded: true });
    expect(rows[6]).toMatchObject({ hasChildren: false, expanded: false });
  });
});

describe("placementFromOffset", () => {
  it("uses quarters for nestable rows and halves otherwise", () => {
    expect(placementFromOffset(0.1, true)).toBe("before");
    expect(placementFromOffset(0.5, true)).toBe("inside");
    expect(placementFromOffset(0.9, true)).toBe("after");
    expect(placementFromOffset(0.4, false)).toBe("before");
    expect(placementFromOffset(0.6, false)).toBe("after");
  });
});

describe("resolveDropTarget", () => {
  const rows = flattenTree(makeTree(), new Set(["card"]));

  it("computes before, after, and inside targets", () => {
    expect(resolveDropTarget(rows, 3, "before", new Set(["status_bar"]))).toMatchObject({ parentId: "card", index: 1, depth: 1 });
    expect(resolveDropTarget(rows, 3, "after", new Set(["status_bar"]))).toMatchObject({ parentId: "card", index: 2 });
    expect(resolveDropTarget(rows, 5, "inside", new Set(["photo"]))).toMatchObject({ parentId: "tab_bar", index: 2, depth: 1 });
  });

  it("inserts as first child when dropping after an expanded parent", () => {
    expect(resolveDropTarget(rows, 1, "after", new Set(["status_bar"]))).toMatchObject({ parentId: "card", index: 0, depth: 1 });
  });

  it("rejects drops onto a dragged node or its descendants", () => {
    expect(resolveDropTarget(rows, 1, "inside", new Set(["card"]))).toBeNull();
    expect(resolveDropTarget(rows, 2, "before", new Set(["card"]))).toBeNull();
    expect(resolveDropTarget(rows, 99, "before", new Set())).toBeNull();
  });
});

describe("moveTreeNodes", () => {
  it("reorders within a parent, adjusting for removed earlier siblings", () => {
    const moved = moveTreeNodes(makeTree(), ["photo"], { parentId: "card", index: 3 }, withChildren);
    expect(findTreeNode(moved, "card")!.children!.map((n) => n.id)).toEqual(["title", "subtitle", "photo"]);

    const root = moveTreeNodes(makeTree(), ["status_bar"], { parentId: null, index: 3 }, withChildren);
    expect(root.map((n) => n.id)).toEqual(["card", "tab_bar", "status_bar", "empty_group"]);
  });

  it("moves several nodes, in tree order, into another parent", () => {
    const moved = moveTreeNodes(makeTree(), ["tab_home", "title"], { parentId: "empty_group", index: 0 }, withChildren);
    expect(ids(moved)).toEqual([
      "status_bar",
      { card: ["photo", "subtitle"] },
      { tab_bar: ["tab_search"] },
      { empty_group: ["title", "tab_home"] },
    ]);
  });

  it("carries subtrees and ignores descendants of moving nodes", () => {
    const moved = moveTreeNodes(makeTree(), ["card", "photo"], { parentId: null, index: 0 }, withChildren);
    expect(ids(moved)).toEqual([{ card: ["photo", "title", "subtitle"] }, "status_bar", { tab_bar: ["tab_home", "tab_search"] }, { empty_group: [] }]);
  });

  it("refuses to move a node into its own subtree", () => {
    const tree = makeTree();
    expect(ids(moveTreeNodes(tree, ["card"], { parentId: "photo", index: 0 }, withChildren))).toEqual(ids(tree));
    expect(ids(moveTreeNodes(tree, ["card"], { parentId: "card", index: 0 }, withChildren))).toEqual(ids(tree));
  });

  it("keeps untouched branches by identity", () => {
    const tree = makeTree();
    const moved = moveTreeNodes(tree, ["tab_search"], { parentId: "tab_bar", index: 0 }, withChildren);
    expect(moved[1]).toBe(tree[1]);
    expect(moved[2]).not.toBe(tree[2]);
    expect(findTreeNode(moved, "tab_bar")!.children!.map((n) => n.id)).toEqual(["tab_search", "tab_home"]);
  });
});

describe("getAncestorIds", () => {
  it("returns the path from the root", () => {
    const tree = makeTree();
    expect(getAncestorIds(tree, "title")).toEqual(["card"]);
    expect(getAncestorIds(tree, "card")).toEqual([]);
    expect(getAncestorIds(tree, "missing")).toBeNull();
  });
});
