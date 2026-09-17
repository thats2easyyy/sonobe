// @vitest-environment happy-dom
import { applyOps, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import type { MenuEntry } from "../../../ui/Menu.tsx";
import { deriveGraph } from "../model/graph.ts";
import type { GraphNodeData, PortSide } from "../model/types.ts";
import type { PatchEditorActions } from "../state/actions.ts";
import { patchMenu, portMenu, type MenuContext } from "./menus.ts";

const registry = getRegistry();

function menuFixture(doc: SonobeDocument, componentId: string) {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const actions = new Proxy({}, { get: (_target, key: string) => (calls[key] ??= vi.fn()) }) as unknown as PatchEditorActions;
  const ctx: MenuContext = { actions, registry, doc, componentId, selectedPatches: [], nested: componentId !== doc.project.root, minimap: false, toggleMinimap: () => undefined, fitView: () => undefined, paste: () => undefined, rename: () => undefined };
  const model = deriveGraph({ doc, componentId, registry });
  const node = (id: string) => model.nodes.find((n) => n.id === id)!.data as GraphNodeData;
  const port = (id: string, side: PortSide, key: string) => {
    const data = node(id);
    if (data.kind === "comment") throw new Error("comments have no ports");
    return (side === "in" ? data.inputs : data.outputs).find((p) => p.key === key)!;
  };
  return { ctx, calls, node, port };
}

type Item = Exclude<MenuEntry, { type: "separator" } | { type: "label" }>;
const items = (entries: readonly MenuEntry[]) => entries.filter((e): e is Item => !("type" in e) || (e.type !== "separator" && e.type !== "label"));
const find = (entries: readonly MenuEntry[], label: string) => items(entries).find((e) => e.label === label);

const withComponent = () => applyOps(createDemoDocument(registry), [{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }], { registry }).doc;

describe("port menu", () => {
  it("publishes an undriven input inside a component, then lists the patch's own entries", () => {
    const { ctx, calls, node, port } = menuFixture(withComponent(), "heart_logic");
    const entries = portMenu(ctx, node("like_spring"), port("like_spring", "in", "bounciness"));
    const publish = find(entries, "Publish as Component Input")!;
    expect(publish).toMatchObject({ disabled: false, shortcut: "Alt+P" });
    publish.onSelect!();
    expect(calls.publishPort).toHaveBeenCalledWith("like_spring.bounciness", "in");
    expect(find(entries, "Patch Info")).toBeDefined();
  });

  it("explains why a driven input can't publish, and offers Disconnect", () => {
    const { ctx, node, port } = menuFixture(withComponent(), "heart_logic");
    const entries = portMenu(ctx, node("like_spring"), port("like_spring", "in", "number"));
    expect(find(entries, "Publish as Component Input")).toMatchObject({ disabled: true, description: "Disconnect this input first" });
    expect(find(entries, "Disconnect")).toBeDefined();
  });

  it("unpublishes a port a published output already reads, and removes published ports from the interface nodes", () => {
    const { ctx, calls, node, port } = menuFixture(withComponent(), "heart_logic");
    const output = portMenu(ctx, node("like_spring"), port("like_spring", "out", "output"));
    expect(find(output, "Unpublish Output")).toBeDefined();
    const iface = portMenu(ctx, node("$in"), port("$in", "out", "flip"));
    const remove = items(iface)[0]!;
    expect(remove.label).toMatch(/^Remove Published Input “.+”$/);
    remove.onSelect!();
    expect(calls.unpublishPort).toHaveBeenCalledWith("flip", "in");
  });

  it("says ports publish from inside a component when you're at the prototype's root", () => {
    const { ctx, node, port } = menuFixture(createDemoDocument(registry), "main");
    const publish = find(portMenu(ctx, node("zoom_spring"), port("zoom_spring", "in", "bounciness")), "Publish as Component Input")!;
    expect(publish.disabled).toBe(true);
    expect(publish.description).toContain("inside a component");
  });
});

describe("patch menu", () => {
  it("offers Component Info on component patches and Jump to Broadcaster on receivers", () => {
    const doc = applyOps(withComponent(), [{ op: "addPatch", component: "main", patch: { id: "reader", type: "variableReceiver", ui: { x: 0, y: 900 } } }], { registry }).doc;
    const { ctx, calls, node } = menuFixture(doc, "main");
    const instance = Object.entries(doc.components.main!.patches).find(([, p]) => p.component === "heart_logic")![0];
    const info = find(patchMenu(ctx, node(instance) as Extract<GraphNodeData, { kind: "patch" }>), "Component Info")!;
    info.onSelect!();
    expect(calls.openComponentInfo).toHaveBeenCalledWith(instance);
    const jump = find(patchMenu(ctx, node("reader") as Extract<GraphNodeData, { kind: "patch" }>), "Jump to Broadcaster")!;
    jump.onSelect!();
    expect(calls.jumpToBroadcaster).toHaveBeenCalledWith("reader");
  });
});
