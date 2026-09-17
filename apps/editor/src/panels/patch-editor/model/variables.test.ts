import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../../state/registry.ts";
import { newVariablePatch, uniqueVariableName } from "./variables.ts";

const registry = getRegistry();

function build(ops: Op[]): SonobeDocument {
  const r = applyOps(createEmptyDocument(), ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

describe("new variable patches", () => {
  it("names a new broadcaster Variable, Variable 2…, or after the output it's inserted from", () => {
    const empty = createEmptyDocument();
    expect(newVariablePatch(empty, registry, ["main"], "variableBroadcaster")).toEqual({ settings: { name: "Variable" } });
    const one = build([{ op: "addPatch", patch: { id: "v", type: "variableBroadcaster", settings: { name: "Variable" }, ui: { x: 0, y: 0 } } }]);
    expect(uniqueVariableName(one, "main")).toBe("Variable 2");
    const spring = build([{ op: "addPatch", patch: { id: "spring", type: "popAnimation", ui: { x: 0, y: 0 } } }]);
    expect(newVariablePatch(spring, registry, ["main"], "variableBroadcaster", "spring.output")).toEqual({ settings: { name: "Output" } });
    expect(newVariablePatch(empty, registry, ["main"], "switch")).toEqual({});
  });

  it("gives a new receiver the only variable it can read", () => {
    const empty = createEmptyDocument();
    expect(newVariablePatch(empty, registry, ["main"], "variableReceiver")).toEqual({});
    const liked = build([{ op: "addPatch", patch: { id: "liked", type: "variableBroadcaster", typeParam: "boolean", settings: { name: "isLiked", scope: "global" }, ui: { x: 0, y: 0 } } }]);
    expect(newVariablePatch(liked, registry, ["main"], "variableReceiver")).toEqual({ settings: { name: "isLiked", scope: "global" }, typeParam: "boolean" });
    const two = build([
      { op: "addPatch", patch: { id: "a", type: "variableBroadcaster", settings: { name: "a" }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "b", type: "variableBroadcaster", settings: { name: "b" }, ui: { x: 0, y: 200 } } },
    ]);
    expect(newVariablePatch(two, registry, ["main"], "variableReceiver")).toEqual({});
  });
});
