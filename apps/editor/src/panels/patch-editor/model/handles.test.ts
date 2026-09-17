import { describe, expect, it } from "vitest";
import { edgesWithRegisteredHandles, missingHandlesKey, parseMissingHandlesKey, type HandleLookup, type InternalNodeLike } from "./handles.ts";

const node = (source: string[], target: string[]): InternalNodeLike => ({ internals: { handleBounds: { source: source.map((id) => ({ id })), target: target.map((id) => ({ id })) } } });
const lookup = (nodes: Record<string, InternalNodeLike>): HandleLookup => new Map(Object.entries(nodes));

const cable = { id: "cable:@card.scale", source: "pop", sourceHandle: "out:output", target: "@card", targetHandle: "in:scale" };

describe("edgesWithRegisteredHandles", () => {
  it("passes cables whose handles are registered, keeping the array", () => {
    const edges = [cable];
    const check = edgesWithRegisteredHandles(edges, lookup({ pop: node(["out:output"], []), "@card": node([], ["in:scale"]) }));
    expect(check.edges).toBe(edges);
    expect(check.missing).toEqual([]);
    expect(check.nodes).toEqual([]);
  });

  it("holds back a cable whose target handle isn't measured yet and names the node to re-measure", () => {
    const other = { id: "cable:grow.progress", source: "pop", sourceHandle: "out:output", target: "grow", targetHandle: "in:progress" };
    const check = edgesWithRegisteredHandles([cable, other], lookup({ pop: node(["out:output"], []), "@card": node([], ["in:opacity"]), grow: node(["out:output"], ["in:progress"]) }));
    expect(check.edges).toEqual([other]);
    expect(check.missing).toEqual(["cable:@card.scale"]);
    expect(check.nodes).toEqual(["@card"]);
  });

  it("holds back a cable whose source handle is missing", () => {
    const check = edgesWithRegisteredHandles([cable], lookup({ pop: node(["out:progress"], []), "@card": node([], ["in:scale"]) }));
    expect(check.missing).toEqual([cable.id]);
    expect(check.nodes).toEqual(["pop"]);
  });

  it("leaves cables to unmeasured nodes to React Flow", () => {
    const check = edgesWithRegisteredHandles([cable], lookup({ pop: node(["out:output"], []), "@card": { internals: {} } }));
    expect(check.missing).toEqual([]);
    expect(edgesWithRegisteredHandles([cable], lookup({})).missing).toEqual([]);
  });

  it("accepts a target handle registered as a source (loose connection mode)", () => {
    const check = edgesWithRegisteredHandles([cable], lookup({ pop: node(["out:output"], []), "@card": node(["in:scale"], []) }));
    expect(check.missing).toEqual([]);
  });
});

describe("missingHandlesKey", () => {
  it("round-trips", () => {
    const key = missingHandlesKey([cable], lookup({ pop: node([], []), "@card": node([], []) }));
    expect(key).toBe("cable:@card.scale|pop,@card");
    expect(parseMissingHandlesKey(key)).toEqual({ missing: ["cable:@card.scale"], nodes: ["pop", "@card"] });
    expect(parseMissingHandlesKey("")).toEqual({ missing: [], nodes: [] });
    expect(missingHandlesKey([cable], lookup({}))).toBe("");
  });
});
