// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { componentInstances, copyInScope, instanceChoiceKey, instanceCopiesAddress, layerSceneKey, resolveLiveScope, scopedAddress, watchedPrefix } from "./instances.ts";

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

describe("watched copies of looped instances", () => {
  it("counts copies through the instance layer you're inside", () => {
    expect(instanceCopiesAddress(resolveLiveScope(withComponents, ["main"]))).toBeNull();
    expect(instanceCopiesAddress(resolveLiveScope(withComponents, ["main", "badge"]))).toBe("@badge_1.position");
    // A patch instance loops only through its inputs: without ports it never has copies.
    expect(instanceCopiesAddress(resolveLiveScope(withComponents, ["main", "press"]), withComponents)).toBeNull();
    expect(instanceCopiesAddress(resolveLiveScope(withComponents, ["main", "unused"]), withComponents)).toBeNull();
  });

  it("counts a component patch's copies through its first published port", () => {
    const doc = build([
      { op: "addComponent", component: { id: "press", name: "Press Feedback", kind: "patchComponent" } },
      { op: "updateInterface", component: "press", inputs: { pressed: { name: "Pressed", type: "boolean" } } },
      { op: "addComponent", component: { id: "badge", name: "Badge", kind: "layerComponent" } },
      { op: "addPatch", patch: { id: "press_a", type: "component", component: "press", ui: { x: 0, y: 40 } } },
      { op: "addLayer", layer: { id: "badge_1", type: "componentInstance", name: "Badge", component: "badge" } },
      { op: "addPatch", component: "badge", patch: { id: "inner", type: "component", component: "press", ui: { x: 0, y: 0 } } },
    ]);
    expect(instanceCopiesAddress(resolveLiveScope(doc, ["main", "press"]), doc)).toBe("press_a.pressed");
    expect(instanceCopiesAddress(resolveLiveScope(doc, ["main", "badge", "press"]), doc)).toBe("badge_1/inner.pressed");
  });

  it("reads which copy a viewer press lands on, for the scope being edited", () => {
    // At the root, the copy of a looped layer (or of a looped group's child).
    expect(copyInScope("card#3", "")).toBe(3);
    expect(copyInScope("card", "")).toBeUndefined();
    expect(copyInScope("list_row#2/title", "")).toBe(2);
    // Inside an instance, the instance's copy, else a looped layer's inside it.
    expect(copyInScope("list_row#2/title", "list_row")).toBe(2);
    expect(copyInScope("list_row#2/title#1", "list_row")).toBe(2);
    expect(copyInScope("list_row/title#1", "list_row")).toBe(1);
    expect(copyInScope("list/row#4/dot", "list/row")).toBe(4);
    // Outside the scope, or the instance itself.
    expect(copyInScope("other#1/title", "list_row")).toBeUndefined();
    expect(copyInScope("list_row#2", "list_row")).toBeUndefined();
  });

  it("finds a layer's scene key in the watched scope and copy", () => {
    const node = (key: string, layerId: string, children: SceneNode[] = []) => ({ key, layerId, children }) as unknown as SceneNode;
    const scene = { roots: [node("field", "field"), node("dot#0", "dot"), node("dot#1", "dot"), node("dot#2", "dot"), node("row#1", "row", [node("row#1/label", "label")])] } as unknown as SceneFrame;
    expect(layerSceneKey(scene, "", "field", 2)).toBe("field");
    expect(layerSceneKey(scene, "", "dot", null)).toBe("dot#0");
    expect(layerSceneKey(scene, "", "dot", 4)).toBe("dot#1");
    expect(layerSceneKey(scene, "row#1", "label", null)).toBe("row#1/label");
    expect(layerSceneKey(scene, "row#0", "label", null)).toBeUndefined();
    expect(layerSceneKey(scene, "", "gone", null)).toBeUndefined();
    expect(layerSceneKey(null, "", "field", null)).toBeUndefined();
  });

  it("reads the watched copy of a looped instance, wrapping past the last", () => {
    const badge = resolveLiveScope(withComponents, ["main", "badge"]);
    expect(watchedPrefix(badge, 12, 3)).toBe("badge_1#3");
    expect(watchedPrefix(badge, 12, 14)).toBe("badge_1#2");
    // Not looped, not watching, at the root, or not running: the scope's own path.
    expect(watchedPrefix(badge, undefined, 3)).toBe("badge_1");
    expect(watchedPrefix(badge, 12, null)).toBe("badge_1");
    expect(watchedPrefix(resolveLiveScope(withComponents, ["main"]), 12, 3)).toBe("");
    expect(watchedPrefix(resolveLiveScope(withComponents, ["main", "unused"]), 12, 3)).toBeNull();
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
