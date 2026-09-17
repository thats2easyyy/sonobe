import { runPatch, buildDoc, createMockRegistry, createTestRuntime, type ComponentInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { variableReceiver } from "./variableReceiver.ts";

const registry = createMockRegistry(definitions);

describe("variableReceiver", () => {
  it("outputs the type's zero value when evaluated outside the graph compiler", () => {
    expect(createPatchHarness(variableReceiver).step().outputs.output).toBe(0);
    expect(createPatchHarness(variableReceiver, { typeParam: "text" }).step().outputs.output).toBe("");
    expect(createPatchHarness(variableReceiver, { typeParam: "color" }).step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(createPatchHarness(variableReceiver, { typeParam: "point" }).step().outputs.output).toEqual([0, 0]);
    expect(createPatchHarness(variableReceiver, { typeParam: "layer" }).step().outputs.output).toBeNull();
  });

  it("outputs the zero value while muted", () => {
    expect(runPatch(variableReceiver, [{}], { muted: true, typeParam: "size" }).frames[0]!.outputs.output).toEqual([0, 0]);
  });

  it("outputs zero and raises unresolved_variable when nothing matches, including an empty name", () => {
    const rt = createTestRuntime(
      buildDoc(
        {
          patches: {
            share: { type: "variableBroadcaster", settings: { name: "Scroll Y" }, inputs: { value: 40 } },
            typo: { type: "variableReceiver", settings: { name: "scroll y" } },
            unnamed: { type: "variableReceiver" },
          },
        },
        registry,
      ),
      registry,
    );
    rt.step();
    expect(rt.getValue("typo.output")).toBe(0);
    expect(rt.getValue("unnamed.output")).toBe(0);
    expect(rt.issues().filter((i) => i.code === "unresolved_variable").map((i) => i.patchId).sort()).toEqual(["typo", "unnamed"]);
  });

  it("follows the nearest global broadcaster into components", () => {
    const card: ComponentInput = {
      id: "card",
      kind: "patchComponent",
      outputs: { dark: { type: "boolean", link: "dark_mode.output" } },
      patches: { dark_mode: { type: "variableReceiver", typeParam: "boolean", settings: { name: "Dark Mode", scope: "global" } } },
    };
    const rt = createTestRuntime(
      buildDoc(
        {
          components: [card],
          patches: {
            share_dark_mode: { type: "variableBroadcaster", typeParam: "boolean", settings: { name: "Dark Mode", scope: "global" }, inputs: { value: true } },
            card_1: { type: "component", component: "card" },
          },
        },
        registry,
      ),
      registry,
    );
    rt.step();
    expect(rt.getValue("card_1.dark")).toBe(true);
  });

  it("re-resolves after a document update", () => {
    const doc = (name: string) =>
      buildDoc(
        {
          patches: {
            share: { type: "variableBroadcaster", settings: { name }, inputs: { value: 12 } },
            r: { type: "variableReceiver", settings: { name: "Gap" } },
          },
        },
        registry,
      );
    const rt = createTestRuntime(doc("Gap"), registry);
    rt.step();
    expect(rt.getValue("r.output")).toBe(12);
    rt.updateDocument(doc("Spacing"));
    rt.step();
    expect(rt.getValue("r.output")).toBe(0);
  });
});
