/**
 * Patch editor harness (dev only): /src/panels/patch-editor/dev/index.html on the editor dev server.
 * Query options: ?nodes=320 (stress graph), ?component=1 (nested patch component; &instances=2 adds a
 * second instance), ?enter=<componentId>, ?drive=<layerId>.<prop> (Drive with a patch on load),
 * ?theme=light, ?minimap=1, ?reduced=1, ?empty=1. `window.__harness` exposes the session, the
 * bridge API, and `resize(width, height)` for scripted checks (screenshots.mjs).
 */

import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { EditorProvider } from "../../../state/EditorProvider.tsx";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, setDefaultSession } from "../../../state/session.ts";
import { ThemeProvider } from "../../../theme/ThemeProvider.tsx";
import "../../../theme/tokens.css";
import "../../../theme/base.css";
import { CommandProvider } from "../../../ui/commands/CommandProvider.tsx";
import { Toaster } from "../../../ui/Toast.tsx";
import { completeConnectionToLayerProp, patchEditorBridge, PatchEditor, PatchEditorBreadcrumbs, startLinkToLayerProp } from "../index.ts";
import "./harness.css";

const params = new URLSearchParams(location.search);
const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

/** Many Interaction → Switch → Pop Animation → Transition chains, framed in comments. */
function stressDocument(count: number): SonobeDocument {
  const chains = Math.max(1, Math.round(count / 4));
  const ops: Op[] = [{ op: "setProject", changes: { name: `Stress ${chains * 4}` } }];
  const columns = 4;
  for (let i = 0; i < chains; i++) {
    const x = (i % columns) * 1180;
    const y = Math.floor(i / columns) * 170 + 40;
    ops.push(
      { op: "addLayer", layer: { id: `box_${i}`, type: "rectangle", name: `Box ${i + 1}`, props: { position: [10 + (i % 8) * 46, 60 + Math.floor(i / 8) * 46], size: [40, 40] } } },
      { op: "addPatch", patch: { id: `tap_${i}`, type: "interaction", inputs: { layer: { layer: `box_${i}` } }, ui: { x, y } } },
      { op: "addPatch", patch: { id: `on_${i}`, type: "switch", ui: { x: x + 220, y } } },
      { op: "addPatch", patch: { id: `pop_${i}`, type: "popAnimation", typeParam: "number", inputs: { bounciness: 4 + (i % 10), speed: 12 }, ui: { x: x + 420, y } } },
      { op: "addPatch", patch: { id: `mix_${i}`, type: "transition", typeParam: "number", inputs: { start: 1, end: 1.4 }, ui: { x: x + 660, y } } },
      { op: "connect", from: `tap_${i}.tap`, to: `on_${i}.flip` },
      { op: "connect", from: `on_${i}.on`, to: `pop_${i}.number` },
      { op: "connect", from: `pop_${i}.output`, to: `mix_${i}.progress` },
      { op: "connect", from: `mix_${i}.output`, to: `@box_${i}.scale` },
    );
  }
  return apply(createEmptyDocument({ name: "Stress" }), ops);
}

/** The demo plus a patch component ("Press Feedback") used from main, once or twice. */
function componentDocument(instances: number): SonobeDocument {
  const ops: Op[] = [
    { op: "addComponent", ref: "press", component: { id: "press_feedback", name: "Press Feedback", kind: "patchComponent" } },
    {
      op: "updateInterface",
      component: "press_feedback",
      inputs: { pressed: { key: "pressed", name: "Pressed", type: "boolean" } },
      outputs: { scale: { key: "scale", name: "Scale", type: "number" } },
    },
    { op: "addPatch", component: "press_feedback", patch: { id: "spring", type: "popAnimation", typeParam: "number", inputs: { bounciness: 8, speed: 18 }, ui: { x: 40, y: 40 } } },
    { op: "addPatch", component: "press_feedback", patch: { id: "shrink", type: "transition", typeParam: "number", inputs: { start: 1, end: 0.94 }, ui: { x: 280, y: 40 } } },
    { op: "connect", component: "press_feedback", from: "$in.pressed", to: "spring.number" },
    { op: "connect", component: "press_feedback", from: "spring.output", to: "shrink.progress" },
    { op: "updateInterface", component: "press_feedback", outputs: { scale: { key: "scale", name: "Scale", type: "number", link: "shrink.output" } } },
    { op: "addPatch", patch: { id: "press_card", type: "component", component: "press_feedback", name: "Press Feedback", ui: { x: 480, y: 660 } } },
    { op: "connect", from: "tap_photo.down", to: "press_card.pressed" },
  ];
  if (instances > 1) {
    ops.push(
      { op: "addPatch", patch: { id: "press_like", type: "component", component: "press_feedback", name: "Like Press", ui: { x: 480, y: 820 } } },
      { op: "connect", from: "tap_like.down", to: "press_like.pressed" },
    );
  }
  return apply(createDemoDocument(registry), ops);
}

const nodes = Number(params.get("nodes") ?? 0);
const doc = params.get("empty") ? createEmptyDocument({ name: "Empty" }) : nodes > 0 ? stressDocument(nodes) : params.get("component") ? componentDocument(Number(params.get("instances") ?? 1)) : createDemoDocument(registry);
const session = createEditorSession({ host: null, document: doc, textMeasurer: "approximate" });
setDefaultSession(session);
if (params.get("enter")) session.selection.getState().enterComponent(params.get("enter")!);

/** Tap a layer in the running prototype (for cable orbs and live values). */
function tapLayer(x: number, y: number) {
  session.runtime.runtime.dispatch([{ kind: "pointer", phase: "down", pointerId: 1, x, y }]);
  setTimeout(() => session.runtime.runtime.dispatch([{ kind: "pointer", phase: "up", pointerId: 1, x, y }]), 60);
}

/** Resize the editor's container (split orientation and panel resizes). */
function resize(width: number | null, height: number | null) {
  const el = document.querySelector<HTMLElement>(".harness");
  if (!el) return;
  el.style.width = width === null ? "" : `${width}px`;
  el.style.height = height === null ? "" : `${height}px`;
}

const drive = (layerId: string, prop: string) => startLinkToLayerProp({ layerId, prop }, { session, show: () => undefined });

(window as unknown as { __harness: unknown }).__harness = {
  session,
  tapLayer,
  resize,
  drive,
  connectToProp: (from: string, layerId: string, prop: string) => completeConnectionToLayerProp(from, { layerId, prop }, { session }),
  bridge: () => patchEditorBridge(session).getState(),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <CommandProvider>
        <EditorProvider session={session} rpc={false}>
          <div className="harness">
            <header className="harness__header">
              <h1 className="harness__title">Patches</h1>
              <PatchEditorBreadcrumbs />
            </header>
            <PatchEditor showBreadcrumbs={false} defaultMinimap={params.get("minimap") === "1"} />
          </div>
          <Toaster />
        </EditorProvider>
      </CommandProvider>
    </ThemeProvider>
  </StrictMode>,
);

const driveParam = params.get("drive");
if (driveParam?.includes(".")) {
  const [layerId, prop] = driveParam.split(".") as [string, string];
  setTimeout(() => drive(layerId, prop), 600);
}
