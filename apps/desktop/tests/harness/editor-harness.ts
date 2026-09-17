/**
 * Editor harness for the Electron smoke test: the real editor session, desktop host adapter, MCP RPC
 * handlers and live viewer from apps/editor/src, without the React shell (which still renders mock
 * panels). Shows the viewer, agent working badges, and AI Activity. Bundled by tests/smoke.mjs.
 */

import { createDesktopHost } from "../../../editor/src/host/desktopHost.ts";
import { getDesktopHostApi } from "../../../editor/src/host/detect.ts";
import { registerRpcHandlers } from "../../../editor/src/host/rpcHandlers.ts";
import { createEditorSession } from "../../../editor/src/state/session.ts";

const status = document.getElementById("status") as HTMLElement;
const api = getDesktopHostApi();
if (!api) {
  status.textContent = "window.sonobeHost is missing: open this page in the Sonobe desktop app.";
  throw new Error("Not running in the Sonobe desktop app");
}

const session = createEditorSession({ host: createDesktopHost(api), appName: "Sonobe Harness" });
registerRpcHandlers(session);
session.runtime.attachRenderer(document.getElementById("viewer") as HTMLElement, { scale: 0.75 });

const working = document.getElementById("working") as HTMLElement;
const activity = document.getElementById("activity") as HTMLElement;
const render = () => {
  const presence = session.presence.getState();
  working.textContent = presence.working.map((item) => `${item.author.name} — ${item.intent}`).join("\n") || "Nobody is working right now.";
  activity.replaceChildren(...presence.recent.map((change) => Object.assign(document.createElement("li"), { textContent: change.description })));
};
session.presence.subscribe(render);
render();
status.textContent = `Ready · ${session.document.getState().doc.project.name}`;
