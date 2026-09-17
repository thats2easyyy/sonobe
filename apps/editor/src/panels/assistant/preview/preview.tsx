/**
 * Visual harness for the Assistant drawer with a fake desktop host (no network, no API calls). Served by
 * the editor dev server at /src/panels/assistant/preview/index.html?view=<view>&theme=dark|light.
 * Views: browser, key, key-unavailable, empty, chat. See screenshots.mjs. Dev only; not part of `vite build`.
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../theme/tokens.css";
import "../../../theme/base.css";
import { Toaster } from "../../../ui/Toast.tsx";
import { createAssistantStore } from "../assistantStore.ts";
import { AssistantDrawer } from "../AssistantDrawer.tsx";
import { createAssistantController } from "../controller.ts";
import { fakeAssistantHost, usage } from "../testing.ts";
import type { AssistantEvent, AssistantUsage } from "../types.ts";

const view = new URLSearchParams(location.search).get("view") ?? "chat";
let scripted = false;

const chatUsage: AssistantUsage = { ...usage(184_000), inputTokens: 9_400, outputTokens: 3_100, cacheReadTokens: 158_000, cacheWriteTokens: 13_500, estimatedCostUsd: 0.37, requests: 4 };
const LIMITS = { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 };

function scriptFirstRun(emit: (event: AssistantEvent) => void) {
  const r = "r1";
  emit({ type: "run_started", runId: r, model: "claude-sonnet-5" });
  emit({ type: "turn_started", runId: r, turn: 1 });
  emit({ type: "text_delta", runId: r, turn: 1, delta: "I'll make the photo spring bigger when you tap it. First, a look at what's there." });
  emit({ type: "tool_started", runId: r, toolUseId: "t1", name: "get_outline", title: "Get outline", detail: "" });
  emit({ type: "tool_finished", runId: r, toolUseId: "t1", name: "get_outline", status: "done", detail: "revision 12 · 8 layers, 4 patches", changedDocument: false });
  emit({ type: "turn_started", runId: r, turn: 2 });
  emit({ type: "tool_started", runId: r, toolUseId: "t2", name: "add_patches", title: "Add patches", detail: "Tap Photo, Zoomed, Zoom Spring" });
  emit({ type: "tool_finished", runId: r, toolUseId: "t2", name: "add_patches", status: "done", detail: "Added 3 patches and 3 connections", changedDocument: true });
  emit({ type: "tool_started", runId: r, toolUseId: "t3", name: "connect", title: "Connect", detail: "1 connection" });
  emit({ type: "tool_finished", runId: r, toolUseId: "t3", name: "connect", status: "error", detail: "Error type_mismatch: Zoomed.on is a boolean; Photo.scale needs a number", changedDocument: false });
  emit({ type: "tool_started", runId: r, toolUseId: "t4", name: "add_patches", title: "Add patches", detail: "Zoom Transition" });
  emit({ type: "tool_finished", runId: r, toolUseId: "t4", name: "add_patches", status: "done", detail: "Added 1 patch and 2 connections", changedDocument: true });
  emit({ type: "turn_started", runId: r, turn: 3 });
  emit({ type: "text_delta", runId: r, turn: 3, delta: "Done. **Tap Photo** flips **Zoomed**, a **Zoom Spring** animates it, and **Zoom Transition** drives the Photo's scale from 1 to 1.08.\n\nTap the photo in the viewer to try it. Every change is in History as “Assistant” if you want to undo." });
  emit({ type: "usage", runId: r, usage: { ...chatUsage, totalTokens: 96_000, estimatedCostUsd: 0.19 }, limits: LIMITS });
  emit({ type: "run_finished", runId: r, outcome: "completed", usage: { ...chatUsage, totalTokens: 96_000, estimatedCostUsd: 0.19 } });
}

function scriptSecondRun(emit: (event: AssistantEvent) => void) {
  const r = "r2";
  emit({ type: "run_started", runId: r, model: "claude-sonnet-5" });
  emit({ type: "turn_started", runId: r, turn: 1 });
  emit({ type: "text_delta", runId: r, turn: 1, delta: "There are 12 leftover items from the old card layout. I'll remove them together." });
  emit({ type: "tool_started", runId: r, toolUseId: "t5", name: "delete_items", title: "Delete items", detail: "12 items" });
  emit({ type: "confirm_required", runId: r, confirmationId: "c1", toolUseId: "t5", title: "Delete 12 items?", message: "Deleting 12 items from main: Old Card (+4 children), Old Title, Old Tap, and 5 more. You can undo it afterwards.", count: 12 });
  emit({ type: "usage", runId: r, usage: chatUsage, limits: LIMITS });
}

function Preview() {
  const [state] = useState(() => {
    const store = createAssistantStore({ persistModel: false });
    if (view === "browser") return { store, host: null, controller: createAssistantController(null, store) };
    const host = fakeAssistantHost({ ...(view === "key" || view === "key-unavailable" ? {} : { key: "sk-ant-api03-preview-key-3f9a" }), ...(view === "key-unavailable" ? { secretsAvailable: false } : {}) });
    let runs = 0;
    host.nextResult = (_request, emit) => {
      runs++;
      if (runs === 1) {
        scriptFirstRun(emit);
        return { runId: "r1", outcome: "completed", usage: chatUsage };
      }
      scriptSecondRun(emit);
      return new Promise(() => undefined);
    };
    return { store, host, controller: createAssistantController(host, store) };
  });

  useEffect(() => {
    // StrictMode runs effects twice in development; script the chat once.
    if (view !== "chat" || scripted) return;
    scripted = true;
    void (async () => {
      await state.controller.refresh();
      await state.controller.send("Make the photo zoom in when I tap it");
      void state.controller.send("Now clean up the old card layers");
    })();
  }, [state]);

  return (
    <div className="sb-assistant-preview">
      <div className="sb-assistant-preview__work" aria-hidden>
        <span>Editor</span>
      </div>
      <aside className="sb-assistant-preview__drawer">
        <AssistantDrawer host={state.host} store={state.store} controller={state.controller} onClose={() => undefined} onConnectClaude={() => undefined} />
      </aside>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  .sb-assistant-preview { display: flex; height: 100%; background: var(--bg-window); }
  .sb-assistant-preview__work { flex: 1; display: grid; place-items: center; color: var(--text-tertiary); font: 13px var(--font-sans); }
  .sb-assistant-preview__drawer { width: 380px; display: flex; border-left: 1px solid var(--border-default); }
  .sb-spin { animation: none; }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
    <Toaster />
  </StrictMode>,
);
