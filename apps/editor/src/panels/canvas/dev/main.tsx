/**
 * Dev harness for the Viewer and Canvas panels with the demo prototype and no persistence.
 * Run `npx vite --port 5202` in apps/editor and open /src/panels/canvas/dev/.
 *
 * Query params: panels=both|viewer|canvas, theme=dark|light, lan=<url> (lan=none hides "On phone";
 * lan=host uses window.sonobeHost's phone preview server), viewerWidth=<px>, autoplay=0.
 * The session is exposed as `window.__sonobe` for visual QA scripts. Dropped files are imported by the
 * session's asset service, which keeps their bytes in memory here.
 */

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../../theme/tokens.css";
import "../../../theme/base.css";
import "../../../shell/AppShell.css";
import { EditorProvider } from "../../../state/EditorProvider.tsx";
import { createEditorSession, setDefaultSession, type EditorSession } from "../../../state/session.ts";
import { Toaster } from "../../../ui/Toast.tsx";
import { CommandProvider } from "../../../ui/commands/CommandProvider.tsx";
import { ViewerPanel } from "../../viewer/index.ts";
import { CanvasPanel } from "../index.ts";

const params = new URLSearchParams(window.location.search);
document.documentElement.setAttribute("data-theme", params.get("theme") === "light" ? "light" : "dark");
const panels = params.get("panels") ?? "both";
const lan = params.get("lan");
const viewerWidth = Number(params.get("viewerWidth")) || null;

const session = createEditorSession({ host: null, autoplay: params.get("autoplay") !== "0" });
setDefaultSession(session);
(window as unknown as { __sonobe?: EditorSession }).__sonobe = session;

const column = { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } as const;

function Harness() {
  const viewerTrack = viewerWidth ? `${viewerWidth}px` : "minmax(320px, 420px)";
  const columns = panels === "both" ? `${viewerTrack} 1fr` : panels === "viewer" && viewerWidth ? `${viewerWidth}px` : "1fr";
  const lanPreviewUrl = lan === "host" ? undefined : lan === "none" ? null : (lan ?? "http://192.168.1.24:5204/p/photo-zoom");
  return (
    <CommandProvider>
      <EditorProvider session={session} rpc={false}>
        <div style={{ display: "grid", gridTemplateColumns: columns, gap: 1, height: "100vh", background: "var(--bg-window)" }}>
          {panels !== "canvas" && (
            <div style={column} data-testid="viewer-column">
              <ViewerPanel {...(lanPreviewUrl === undefined ? {} : { lanPreviewUrl })} onCollapse={() => undefined} />
            </div>
          )}
          {panels !== "viewer" && (
            <div style={column} data-testid="canvas-column">
              <CanvasPanel />
            </div>
          )}
        </div>
        <Toaster />
      </EditorProvider>
    </CommandProvider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
// Hot updates to shared modules can re-run this file in the same page: keep one React root.
const harnessWindow = window as unknown as { __sonobeHarnessRoot?: Root };
harnessWindow.__sonobeHarnessRoot ??= createRoot(container);
harnessWindow.__sonobeHarnessRoot.render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
