// @vitest-environment happy-dom
import { applyOps, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession } from "../../../state/session.ts";
import { publishedKeyOf, publishPortPlan, unpublishOps, updatePublishedOps } from "./publish.ts";

const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]) {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

/** The demo with Liked and Like Spring grouped into a patch component "Heart Logic" (as ⌃⌘G does). */
function withComponent(): SonobeDocument {
  return apply(createDemoDocument(registry), [{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }]);
}

const logic = (doc: SonobeDocument) => doc.components.heart_logic!;

describe("publishPortPlan", () => {
  it("publishes an input with its current value as the default, driven from the new published input", () => {
    const doc = withComponent();
    const plan = publishPortPlan(doc, "heart_logic", registry, "like_spring.bounciness", "in");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan).toMatchObject({ key: "bounciness", name: "Bounciness", side: "in" });
    const after = apply(doc, plan.ops);
    expect(logic(after).interface.inputs.bounciness).toMatchObject({ key: "bounciness", name: "Bounciness", type: "number", default: logic(doc).patches.like_spring!.inputs.bounciness ?? 5 });
    expect(logic(after).patches.like_spring!.inputs.bounciness).toEqual({ link: "$in.bounciness" });
    expect(publishedKeyOf(logic(after), "like_spring.bounciness", "in")).toBe("bounciness");
    // Where the component is placed, Bounciness is a property now.
    const instance = Object.values(after.components.main!.patches).find((p) => p.component === "heart_logic")!;
    expect(instance).toBeDefined();
    expect(publishPortPlan(after, "heart_logic", registry, "like_spring.bounciness", "in")).toMatchObject({ error: "Bounciness is already published." });
  });

  it("publishes an output as a published output that reads it, with a unique key and name", () => {
    // Grouping already published Like Spring's output (a cable crossed the selection's edge).
    const grouped = withComponent();
    expect(publishPortPlan(grouped, "heart_logic", registry, "like_spring.output", "out")).toMatchObject({ error: "Output is already published." });
    const doc = apply(grouped, [{ op: "updateInterface", component: "heart_logic", outputs: { on: { key: "on", name: "On", type: "number", link: "like_spring.output" } } }]);
    const plan = publishPortPlan(doc, "heart_logic", registry, "liked.on", "out");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan).toMatchObject({ key: "on_2", name: "Liked On", side: "out" });
    const after = apply(doc, plan.ops);
    expect(logic(after).interface.outputs.on_2).toMatchObject({ link: "liked.on", type: "boolean" });
    expect(publishedKeyOf(logic(after), "liked.on", "out")).toBe("on_2");
  });

  it("explains what's in the way: the root prototype, or an input a cable drives", () => {
    const doc = withComponent();
    expect(publishPortPlan(doc, "main", registry, "zoom_spring.bounciness", "in")).toMatchObject({ error: "Only components have published ports." });
    expect(publishPortPlan(doc, "heart_logic", registry, "like_spring.number", "in")).toMatchObject({ error: "Number is already driven by a cable." });
    expect(publishPortPlan(doc, "heart_logic", registry, "nope.port", "in")).toMatchObject({ error: "That port can't be published." });
  });
});

describe("unpublishOps and updatePublishedOps", () => {
  it("unpublishes an input and gives the ports it drove its default back", () => {
    const doc = withComponent();
    const plan = publishPortPlan(doc, "heart_logic", registry, "like_spring.bounciness", "in");
    if ("error" in plan) throw new Error(plan.error);
    const published = apply(doc, plan.ops);
    const renamed = apply(published, updatePublishedOps(logic(published), "in", "bounciness", { name: "Bounce", default: 9 }));
    expect(logic(renamed).interface.inputs.bounciness).toMatchObject({ name: "Bounce", default: 9 });
    const removed = apply(renamed, unpublishOps(logic(renamed), "bounciness", "in"));
    expect(logic(removed).interface.inputs.bounciness).toBeUndefined();
    expect(logic(removed).patches.like_spring!.inputs.bounciness).toBe(9);
  });

  it("publishes as one undo step", () => {
    const session = createEditorSession({ host: null, registry, document: withComponent(), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    try {
      const doc = session.document.getState().doc;
      const plan = publishPortPlan(doc, "heart_logic", registry, "like_spring.speed", "in");
      if ("error" in plan) throw new Error(plan.error);
      expect(session.document.getState().apply(plan.ops, { label: "Publish Like Spring · Speed" }).ok).toBe(true);
      expect(session.document.getState().historyEntries().map((e) => e.label)).toEqual(["Publish Like Spring · Speed"]);
      session.document.getState().undo();
      expect(session.document.getState().doc).toStrictEqual(doc);
    } finally {
      session.dispose();
    }
  });
});
