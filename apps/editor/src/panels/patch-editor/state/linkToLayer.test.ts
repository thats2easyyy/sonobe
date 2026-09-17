// @vitest-environment happy-dom
import { findLayer } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { layoutStore } from "../../../shell/layoutStore.ts";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { mountedPatchEditor, patchEditorBridge, registerPatchEditor } from "./bridge.ts";
import { acceptsCable, canDriveLayerProp, completeConnectionToLayerProp, dropTargetAt, layerDropAttributes, layerPropDropAttributes, startLinkToLayerProp } from "./linkToLayer.ts";

const registry = getRegistry();
let session: EditorSession;

beforeEach(() => {
  session = createEditorSession({ host: null, registry, document: createDemoDocument(registry), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
});

afterEach(() => {
  session.dispose();
});

const prop = (layerId: string, key: string) => findLayer(session.document.getState().doc.components.main!.layers, layerId)?.layer.props[key];

describe("canDriveLayerProp", () => {
  it("knows a property's type and current driver, and explains what can't be driven", () => {
    const doc = session.document.getState().doc;
    expect(canDriveLayerProp(doc, "main", registry, { layerId: "photo", prop: "scale" })).toMatchObject({ ok: true, address: "@photo.scale", type: "number", layerName: "Photo", propName: "Scale", driver: "photo_scale.output" });
    expect(canDriveLayerProp(doc, "main", registry, { layerId: "photo", prop: "nope" })).toEqual({ ok: false, reason: 'Photo has no property "nope".' });
    expect(canDriveLayerProp(doc, "main", registry, { layerId: "ghost", prop: "scale" })).toMatchObject({ ok: false });
  });
});

describe("startLinkToLayerProp", () => {
  it("shows an undriven property on the layer's node, asks the patch editor to pick a driver, and opens the patch editor", () => {
    layoutStore.getState().setViewMode("canvas");
    expect(startLinkToLayerProp({ layerId: "photo", prop: "opacity" }, { session })).toBe(true);
    const state = patchEditorBridge(session).getState();
    expect(state.targets.main).toEqual(["@photo.opacity"]);
    expect(state.request).toMatchObject({ kind: "drive", component: "main", address: "@photo.opacity" });
    expect(layoutStore.getState().viewMode).toBe("split");
  });

  it("asks for a driver without adding a target when the property is already driven", () => {
    expect(startLinkToLayerProp({ layerId: "photo", prop: "scale" }, { session, show: () => undefined })).toBe(true);
    expect(patchEditorBridge(session).getState().targets.main).toBeUndefined();
    expect(patchEditorBridge(session).getState().request?.address).toBe("@photo.scale");
  });

  it("refuses properties that don't exist", () => {
    expect(startLinkToLayerProp({ layerId: "photo", prop: "nope" }, { session })).toBe(false);
    expect(patchEditorBridge(session).getState().request).toBeNull();
  });
});

describe("completeConnectionToLayerProp", () => {
  it("connects through the document when no patch editor is showing, and clears the target", () => {
    patchEditorBridge(session).getState().addTarget("main", "@photo.opacity");
    expect(completeConnectionToLayerProp("zoom_spring.output", { layerId: "photo", prop: "opacity" }, { session })).toBe(true);
    expect(prop("photo", "opacity")).toEqual({ link: "zoom_spring.output" });
    expect(patchEditorBridge(session).getState().targets.main).toBeUndefined();
    expect(session.document.getState().undo().ok).toBe(true);
    expect(prop("photo", "opacity")).toBeUndefined();
  });

  it("goes through a mounted patch editor so mismatches can offer converters", () => {
    const calls: [string, string][] = [];
    const unregister = registerPatchEditor(session, {
      componentId: "main",
      connect: (from, to) => {
        calls.push([from, to]);
        return true;
      },
    });
    expect(mountedPatchEditor(session, "main")).toBeDefined();
    expect(completeConnectionToLayerProp("like_spring.output", { layerId: "photo", prop: "scale" }, { session })).toBe(true);
    expect(calls).toEqual([["like_spring.output", "@photo.scale"]]);
    unregister();
    expect(mountedPatchEditor(session)).toBeUndefined();
  });

  it("reports types that don't connect", () => {
    expect(completeConnectionToLayerProp("tap_photo.tap", { layerId: "heart", prop: "textColor" }, { session })).toBe(false);
    expect(prop("heart", "textColor")).toEqual({ link: "heart_color.output" });
  });
});

describe("drop targets", () => {
  const annotated = (attributes: Record<string, string>) => {
    const row = document.createElement("div");
    for (const [k, v] of Object.entries(attributes)) row.setAttribute(k, v);
    const child = document.createElement("span");
    row.appendChild(child);
    document.body.appendChild(row);
    return child;
  };

  it("reads property rows and layer rows from their attributes", () => {
    expect(dropTargetAt(annotated(layerPropDropAttributes({ layerId: "photo", prop: "scale", component: "main" })))).toEqual({ kind: "prop", target: { layerId: "photo", prop: "scale", component: "main" } });
    expect(dropTargetAt(annotated(layerDropAttributes("card")))).toEqual({ kind: "layer", layerId: "card" });
    expect(dropTargetAt(document.body)).toBeUndefined();
  });

  it("says whether a dragged cable fits a property type", () => {
    const drag = { component: "main", from: "zoom_spring.output", type: "number" as const };
    expect(acceptsCable(drag, "number")).toBe(true);
    expect(acceptsCable({ ...drag, type: "pulse" }, "color")).toBe(false);
    expect(acceptsCable(null, "number")).toBe(false);
  });
});
