/**
 * Visual harness for the HUD, the Learn drawer, and Connect Claude with a real editor session: the
 * demo document plus a few problems, console output, agent changes, and work in progress. Served by
 * the editor dev server at /src/panels/hud/preview/index.html?view=<view>&theme=dark|light.
 * Views: hud-console, hud-diagnostics, hud-ai, hud-performance, learn-home, learn-guide, learn-patch,
 * learn-patches, connect-desktop, connect-desktop-config, connect-browser. See screenshots.mjs.
 */

import { getDevicePreset, type Op, type SonobeDocument } from "@sonobe/core";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../theme/tokens.css";
import "../../../theme/base.css";
import { CLAUDE_AUTHOR } from "../../../state/document.ts";
import { EditorProvider, useDocument, useEditorSession } from "../../../state/EditorProvider.tsx";
import { createEditorSession, setDefaultSession, type EditorSession } from "../../../state/session.ts";
import { CommandProvider } from "../../../ui/commands/CommandProvider.tsx";
import { toast, Toaster } from "../../../ui/Toast.tsx";
import { ConnectClaudeButton, ConnectClaudeDialog, type ConnectHostLike } from "../../connect/index.ts";
import { LearnDrawer, type LearnView } from "../../learn/index.ts";
import { Hud, type HudTabId } from "../index.ts";
import "./preview.css";

/** A session the app heard from `secondsAgo` seconds ago (Connect Claude's session rows). */
const previewSession = (id: string, folder: string, secondsAgo: number, extra: Record<string, unknown> = {}) => {
  const now = Date.now();
  return { id, label: "Claude Code", name: "claude-code", version: "2.1.278", folder, via: "relay", state: "connected", connectedAt: now - 20 * 60_000, lastSeenAt: now, lastActivityAt: now - secondsAgo * 1000, lastTool: "sim_trace", toolCalls: 42, relayVersion: "0.1.0", ...extra };
};

const DESKTOP_HOST: ConnectHostLike = {
  platform: "darwin",
  getMcpStatus: async () => ({
    running: true,
    port: 52817,
    url: "http://127.0.0.1:52817/mcp",
    tokenFile: "/Users/you/.sonobe/mcp.json",
    version: "0.1.0",
    checkedAt: Date.now(),
    clients: [previewSession("0f6b2c1e-5d0a-4a57-9a3e-1c2d3e4f5a60", "/Users/you/workspace/placemark", 12), previewSession("7a1c9e44-2b3d-4c5e-8f60-718293a4b5c6", "/Users/you/workspace/sonobe", 540, { state: "gone", lastTool: "finish_work", toolCalls: 7 })],
  }),
};

function withProblems(doc: SonobeDocument): SonobeDocument {
  const main = doc.components[doc.project.root]!;
  return {
    ...doc,
    components: {
      ...doc.components,
      [main.id]: {
        ...main,
        patches: {
          ...main.patches,
          glow_spring: { type: "popAnimaton", name: "Glow Spring", inputs: {}, ui: { x: 480, y: 660 } },
          fade_in: { type: "transition", name: "Fade In", typeParam: "number", inputs: { progress: { link: "old_tap.tap" }, start: 0, end: 1 }, ui: { x: 720, y: 660 } },
        },
      },
    },
  };
}

function seed(session: EditorSession) {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  const at = (minutesAgo: number) => {
    offset = -minutesAgo * 60_000;
  };
  const apply = (ops: Op[], label: string, agent = false) => {
    const result = session.document.getState().apply(ops, { label, ...(agent ? { author: CLAUDE_AUTHOR } : {}) });
    if (!result.ok) console.warn(`preview: "${label}" failed`, result.errors);
  };
  try {
    at(45);
    session.document.getState().replaceDocument(withProblems(session.document.getState().doc), { saved: true, label: "Opened Photo Zoom" });
    at(40);
    apply([{ op: "addPatch", patch: { id: "double_tap", type: "interaction", name: "Double Tap", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 800 } } }, { op: "connect", from: "double_tap.tap", to: "card_shadow.start" }], "Add Double Tap");
    at(22);
    apply(
      [
        { op: "setInput", target: "zoom_spring.bounciness", value: 9 },
        { op: "setInput", target: "zoom_spring.speed", value: 14 },
      ],
      "tuned the zoom spring to feel snappier",
      true,
    );
    at(13);
    apply(
      [
        { op: "addPatch", patch: { id: "press_like", type: "interaction", name: "Press Like", inputs: { layer: { layer: "like_button" } }, ui: { x: 40, y: 940 } } },
        { op: "addPatch", patch: { id: "press_spring", type: "popAnimation", name: "Press Spring", typeParam: "number", inputs: { bounciness: 8, speed: 16 }, ui: { x: 260, y: 940 } } },
        { op: "addPatch", patch: { id: "press_scale", type: "transition", name: "Press Scale", typeParam: "number", inputs: { start: 1, end: 0.92 }, ui: { x: 480, y: 940 } } },
        { op: "connect", from: "press_like.down", to: "press_spring.number" },
        { op: "connect", from: "press_spring.output", to: "press_scale.progress" },
      ],
      "added a press animation to the like button",
      true,
    );
    at(9);
    const work = session.presence.getState().begin({ intent: "checking the press animation settles under 300 ms", ids: ["press_spring"], component: "main" });
    at(8);
    session.presence.getState().finish(work, { summary: "Verified the press spring settles in 280 ms with 2% overshoot" });
    at(5);
    apply(
      [
        { op: "rename", id: "zoomed", name: "Is Zoomed" },
        { op: "rename", id: "liked", name: "Is Liked" },
      ],
      "named the switches by their state",
      true,
    );
    at(3);
    session.document.getState().undo();

    at(6);
    session.console.getState().push("info", "Prototype restarted", { source: "prototype" });
    at(4.5);
    for (let i = 0; i < 4; i++) session.console.getState().push("log", ["like spring velocity", 12.4], { source: "like_spring", componentPath: "main" });
    session.console.getState().push("log", ["zoom state", { zoomed: true, scale: 1.18 }], { source: "zoom_spring", componentPath: "main" });
    at(3.2);
    session.console.getState().push("warn", "Loop capped at 10,000 items. Check the Loop patch's count.", { source: "prototype" });
    at(2.4);
    session.console.getState().push("error", "SyntaxError on line 12: Unexpected token ')'. Check for an extra closing parenthesis.", { source: "fade_in", componentPath: "main" });
    at(1.1);
    session.console.getState().push("info", "Claude connected over MCP", { source: "claude" });
    session.console.getState().push("log", "tap at 214, 388", { source: "tap_photo", componentPath: "main" });
    session.console.getState().flush();

    at(0.4);
    session.presence.getState().begin({ intent: "building the tab bar's selected state", ids: ["press_like", "press_spring", "press_scale"], component: "main" });
  } finally {
    Date.now = realNow;
  }
}

function Viewer() {
  const session = useEditorSession();
  const preset = useDocument((s) => s.doc.project.device.preset);
  const ref = useRef<HTMLDivElement>(null);
  const size = getDevicePreset(preset).size;
  const scale = 0.56;
  useEffect(() => {
    const handle = session.runtime.attachRenderer(ref.current!, { scale });
    return () => handle.dispose();
  }, [session]);
  return <div className="pv-viewer" ref={ref} style={{ width: size[0] * scale, height: size[1] * scale }} />;
}

function PreviewApp({ view }: { view: string }) {
  const hudTab: HudTabId = view.startsWith("hud-") ? (view.slice(4) as HudTabId) : "console";
  const learnView: LearnView | null =
    view === "learn-home" ? { kind: "home" } : view === "learn-guide" ? { kind: "guide", slug: "05-springs-and-feel" } : view === "learn-patch" ? { kind: "patches", type: "popAnimation" } : view === "learn-patches" ? { kind: "patches", type: null } : null;
  const [connectOpen, setConnectOpen] = useState(view.startsWith("connect-"));
  const host = view === "connect-browser" ? null : DESKTOP_HOST;

  useEffect(() => {
    const timer = setTimeout(() => document.body.setAttribute("data-preview-ready", ""), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="pv-app">
      <header className="pv-toolbar">
        <span className="pv-toolbar__name">Photo Zoom</span>
        <span className="pv-spacer" />
        <ConnectClaudeButton host={host} onClick={() => setConnectOpen(true)} />
      </header>
      <div className="pv-main">
        <div className="pv-stage">
          <Viewer />
        </div>
        {learnView && (
          <aside className="pv-drawer" aria-label="Learn">
            <LearnDrawer defaultView={learnView} onClose={() => undefined} onConnectClaude={() => setConnectOpen(true)} onInsertPatch={(type) => toast({ title: `Would add ${type}`, tone: "info" })} />
          </aside>
        )}
      </div>
      <div className="pv-hud">
        <Hud defaultTab={hudTab} onToggleCollapse={() => undefined} onConnectClaude={() => setConnectOpen(true)} />
      </div>
      <ConnectClaudeDialog open={connectOpen} onOpenChange={setConnectOpen} host={host} initialTab={view === "connect-desktop-config" ? "desktop" : "code"} onOpenGuide={() => undefined} />
    </div>
  );
}

const view = new URLSearchParams(location.search).get("view") ?? "hud-console";
const session = createEditorSession({ host: null });
setDefaultSession(session);
seed(session);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CommandProvider>
      <EditorProvider session={session} commands={false} clipboardEvents={false} rpc={false}>
        <PreviewApp view={view} />
        <Toaster />
      </EditorProvider>
    </CommandProvider>
  </StrictMode>,
);
