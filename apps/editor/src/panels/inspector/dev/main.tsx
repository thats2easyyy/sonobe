/**
 * Inspector + Layers harness (dev only): /src/panels/inspector/dev/index.html on the editor dev server.
 * Layers | Patch Editor | Inspector on the real session with the Photo Zoom demo plus an empty Image
 * layer. Query options: ?theme=light, ?select=<layerId>, ?patch=<patchId>. `window.__harness` exposes
 * the session, the patch editor bridge state, and `select(items)` for scripted checks (screenshots.mjs).
 */

import { applyOps, type SonobeDocument } from "@sonobe/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "../../../shell/Panel.tsx";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { EditorProvider } from "../../../state/EditorProvider.tsx";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, setDefaultSession } from "../../../state/session.ts";
import { ThemeProvider } from "../../../theme/ThemeProvider.tsx";
import "../../../theme/tokens.css";
import "../../../theme/base.css";
import "../../../shell/AppShell.css";
import { CommandProvider } from "../../../ui/commands/CommandProvider.tsx";
import { Toaster } from "../../../ui/Toast.tsx";
import { LayersPanel } from "../../layers/index.ts";
import { patchEditorBridge, PatchEditor, PatchEditorBreadcrumbs } from "../../patch-editor/index.ts";
import { InspectorPanel } from "../index.ts";
import "./harness.css";

const params = new URLSearchParams(location.search);
const registry = getRegistry();

function harnessDocument(): SonobeDocument {
  const demo = createDemoDocument(registry);
  const result = applyOps(demo, [{ op: "addLayer", layer: { id: "hero", type: "image", name: "Hero Image", props: { position: [16, 640], size: [180, 120], cornerRadius: 12 } } }], { registry });
  return result.ok ? result.doc : demo;
}

const session = createEditorSession({ host: null, document: harnessDocument(), textMeasurer: "approximate", platform: null });
setDefaultSession(session);
if (params.get("select")) session.selection.getState().select({ layers: [params.get("select")!] });
if (params.get("patch")) session.selection.getState().select({ patches: [params.get("patch")!] });

(window as unknown as { __harness: unknown }).__harness = {
  session,
  bridge: () => patchEditorBridge(session).getState(),
  select: (items: { layers?: string[]; patches?: string[] }) => session.selection.getState().select(items),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <CommandProvider>
        <EditorProvider session={session} rpc={false}>
          <div className="ilh">
            <LayersPanel className="ilh__layers" />
            <Panel title="Patches" scope="patchEditor" surface="sunken" className="ilh__patches" headerContent={<PatchEditorBreadcrumbs />}>
              <PatchEditor showBreadcrumbs={false} />
            </Panel>
            <InspectorPanel className="ilh__inspector" />
          </div>
          <Toaster />
        </EditorProvider>
      </CommandProvider>
    </ThemeProvider>
  </StrictMode>,
);

document.body.setAttribute("data-harness-ready", "");
