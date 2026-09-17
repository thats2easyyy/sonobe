// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { componentInstances, instanceChoiceKey, resolveLiveScope, scopedAddress } from "./instances.ts";

const registry = createPatchRegistry();

function build(ops: Op[]): SonobeDocument {
  const r = applyOps(createEmptyDocument(), ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

const withComponents = build([
  { op: "addComponent", component: { id: "press", name: "Press Feedback", kind: "patchComponent" } },
  { op: "addComponent", component: { id: "badge", name: "Badge", kind: "layerComponent" } },
  { op: "addComponent", component: { id: "unused", name: "Unused", kind: "patchComponent" } },
  { op: "addPatch", patch: { id: "press_b", type: "component", component: "press", name: "Second Press", ui: { x: 0, y: 300 } } },
  { op: "addPatch", patch: { id: "press_a", type: "component", component: "press", ui: { x: 0, y: 40 } } },
  { op: "addLayer", layer: { id: "group", type: "group", name: "Group", children: [{ id: "badge_1", type: "componentInstance", name: "Top Badge", component: "badge" }] } },
  { op: "addPatch", component: "badge", patch: { id: "inner", type: "component", component: "press", ui: { x: 0, y: 0 } } },
]);

describe("componentInstances", () => {
  it("lists patch instances top-first, then layer instances", () => {
    expect(componentInstances(withComponents, "main", "press").map((i) => [i.id, i.name, i.kind])).toEqual([
      ["press_a", "Press Feedback", "patch"],
      ["press_b", "Second Press", "patch"],
    ]);
    expect(componentInstances(withComponents, "main", "badge")).toEqual([{ id: "badge_1", name: "Top Badge", kind: "layer" }]);
  });
});

describe("resolveLiveScope", () => {
  it("is the empty path for the root component", () => {
    expect(resolveLiveScope(withComponents, ["main"])).toEqual({ prefix: "", steps: [] });
  });

  it("follows a patch component instance, choosing the first unless told otherwise", () => {
    const first = resolveLiveScope(withComponents, ["main", "press"]);
    expect(first.prefix).toBe("press_a");
    expect(first.steps[0]).toMatchObject({ parent: "main", component: "press", instance: "press_a" });
    expect(first.steps[0]!.instances).toHaveLength(2);
    const chosen = resolveLiveScope(withComponents, ["main", "press"], { [instanceChoiceKey("main", "press")]: "press_b" });
    expect(chosen.prefix).toBe("press_b");
    const stale = resolveLiveScope(withComponents, ["main", "press"], { [instanceChoiceKey("main", "press")]: "gone" });
    expect(stale.prefix).toBe("press_a");
  });

  it("nests through layer component instances", () => {
    expect(resolveLiveScope(withComponents, ["main", "badge", "press"]).prefix).toBe("badge_1/inner");
  });

  it("finds a path from the root when the component path doesn't start there", () => {
    expect(resolveLiveScope(withComponents, ["badge"]).prefix).toBe("badge_1");
  });

  it("is null for components the prototype doesn't use", () => {
    expect(resolveLiveScope(withComponents, ["main", "unused"]).prefix).toBeNull();
    expect(resolveLiveScope(withComponents, ["unused"]).prefix).toBeNull();
  });
});

describe("scopedAddress", () => {
  it("prefixes patch and layer addresses the way the engine reads them", () => {
    expect(scopedAddress("", "pop.output")).toBe("pop.output");
    expect(scopedAddress("press_a", "spring.output")).toBe("press_a/spring.output");
    expect(scopedAddress("badge_1/inner", "@dot.scale")).toBe("@badge_1/inner/dot.scale");
    expect(scopedAddress("press_a", "$in.pressed")).toBe("press_a/$in.pressed");
  });
});
