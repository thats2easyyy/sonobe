// @vitest-environment happy-dom
import { createEmptyDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { ConnectClaudeButton } from "./ConnectClaudeButton.tsx";
import type { McpStatusSource } from "./useMcpStatus.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RUNNING = { running: true, port: 52817, url: "http://127.0.0.1:52817/mcp", tokenFile: "/Users/me/.sonobe/mcp.json", cliPath: null, version: "0.1.0" };
const now = Date.now();
const session = (id: string, folder: string, state = "connected") => ({ id, label: "Claude Code", name: "claude-code", version: "2.1.278", folder, via: "relay", state, connectedAt: now - 60_000, lastSeenAt: now, lastActivityAt: now - 12_000, lastTool: "get_outline", toolCalls: 3, relayVersion: "0.1.0" });

let container: HTMLDivElement;
let root: Root;
let editor: EditorSession;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  editor = createEditorSession({ host: null, registry: getRegistry(), document: createEmptyDocument({ name: "Test" }), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/** Render the button over a host reporting `status`; returns the button. */
async function show(status: Record<string, unknown>): Promise<HTMLButtonElement> {
  const host: McpStatusSource = { getMcpStatus: () => Promise.resolve(status) };
  await act(async () => {
    root.render(
      <EditorProvider session={editor} commands={false} clipboardEvents={false} rpc={false}>
        <ConnectClaudeButton host={host} onClick={() => {}} />
      </EditorProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container.querySelector("button")!;
}

describe("ConnectClaudeButton", () => {
  it("isn't green while nothing is connected, even though the server runs", async () => {
    const button = await show({ ...RUNNING, clients: [] });
    expect(button.dataset.state).toBe("ready");
    expect(button.textContent).toBe("Connect Claude");
  });

  it("doesn't count sessions that left", async () => {
    const button = await show({ ...RUNNING, clients: [session("11111111-aaaa-4bbb-8ccc-000000000001", "/Users/me/placemark", "gone")] });
    expect(button.dataset.state).toBe("ready");
  });

  it("goes green for a connected session", async () => {
    const button = await show({ ...RUNNING, clients: [session("11111111-aaaa-4bbb-8ccc-000000000001", "/Users/me/placemark")] });
    expect(button.dataset.state).toBe("connected");
    expect(button.textContent).toBe("Claude");
  });

  it("counts several connected sessions", async () => {
    const button = await show({ ...RUNNING, clients: [session("11111111-aaaa-4bbb-8ccc-000000000001", "/Users/me/placemark"), session("22222222-aaaa-4bbb-8ccc-000000000002", "/Users/me/sonobe")] });
    expect(button.dataset.state).toBe("connected");
    expect(button.textContent).toBe("Claude ×2");
  });

  it("warns when the server is off", async () => {
    const button = await show({ running: false, port: null, url: null, tokenFile: "/Users/me/.sonobe/mcp.json", clients: [] });
    expect(button.dataset.state).toBe("off");
  });

  it("shows working while an agent has a badge", async () => {
    editor.presence.getState().begin({ intent: "Tuning the deck", client: { id: "11111111-aaaa-4bbb-8ccc-000000000001", label: "Claude Code", folder: "/Users/me/placemark" } });
    const button = await show({ ...RUNNING, clients: [] });
    expect(button.dataset.state).toBe("working");
    expect(button.textContent).toBe("Claude is working");
  });
});
