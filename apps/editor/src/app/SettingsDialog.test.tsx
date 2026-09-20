// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantStore, initialAssistantData } from "../panels/assistant/assistantStore.ts";
import { createAssistantController, type AssistantController } from "../panels/assistant/controller.ts";
import { fakeAssistantHost, type FakeAssistantHost } from "../panels/assistant/testing.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { EditorProvider } from "../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { SettingsDialog, SUBSCRIPTION_SWITCH_DESCRIPTION, SUBSCRIPTION_SWITCH_LABEL } from "./SettingsDialog.tsx";

// Each test gets its own controller over its own fake host; Settings asks the shared one.
const h = vi.hoisted(() => ({ controller: null as AssistantController | null }));
vi.mock("../panels/assistant/controller.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../panels/assistant/controller.ts")>()), sharedAssistantController: () => h.controller! }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;

beforeEach(() => {
  assistantStore.setState(initialAssistantData());
  session = createEditorSession({ host: null, scheduler: createManualScheduler(), textMeasurer: "approximate", autoplay: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  h.controller?.dispose();
  h.controller = null;
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  session.dispose();
  container.remove();
  document.body.innerHTML = "";
});

async function mount(host: FakeAssistantHost | null) {
  if (host) (window as { sonobeHost?: unknown }).sonobeHost = host;
  h.controller = createAssistantController(host, assistantStore);
  await act(async () => {
    root.render(
      <ThemeProvider>
        <EditorProvider session={session} commands={false} clipboardEvents={false} rpc={false}>
          <SettingsDialog open onOpenChange={() => undefined} />
        </EditorProvider>
      </ThemeProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const subscriptionSwitch = () => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${SUBSCRIPTION_SWITCH_LABEL}"]`);

describe("Settings → Claude → the experimental subscription switch", () => {
  it("is off by default, and says it's awaiting Anthropic's permission and in no release", async () => {
    const host = fakeAssistantHost();
    await mount(host);
    const toggle = subscriptionSwitch()!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false);
    const row = toggle.closest('[role="group"]')!;
    expect(row.textContent).toContain("Use my Claude subscription in the Assistant");
    expect(row.textContent).toContain("Experimental · awaiting Anthropic's permission. Off by default and not part of any release until Anthropic agrees.");
    expect(row.textContent).toContain(SUBSCRIPTION_SWITCH_DESCRIPTION);
    // Nothing tells anyone how to turn it on in a release: no environment variable, no command.
    expect(row.textContent).not.toMatch(/SONOBE_|environment|npm |=1/);
    expect(row.closest("section")?.getAttribute("aria-label")).toBe("Claude");
    expect(host.connectionCalls).toEqual([]);
    // A screen reader hears the whole description with the switch.
    expect(document.getElementById(toggle.getAttribute("aria-describedby")!)?.textContent).toBe(SUBSCRIPTION_SWITCH_DESCRIPTION);
  });

  it("isn't there, and says nothing, in a build that doesn't offer it", async () => {
    const host = fakeAssistantHost({ connection: { available: false } });
    await mount(host);
    expect(assistantStore.getState().status?.connection?.available).toBe(false);
    expect(subscriptionSwitch()).toBeNull();
    expect(document.body.textContent).not.toContain("awaiting Anthropic's permission");
    expect(document.body.textContent).not.toContain("Claude subscription");
  });

  it("asks main to turn it on and off, and shows what main says", async () => {
    const host = fakeAssistantHost();
    await mount(host);
    await act(async () => subscriptionSwitch()!.click());
    expect(host.connectionCalls).toEqual([{ subscriptionEnabled: true }]);
    expect(subscriptionSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(assistantStore.getState().status?.connection?.subscriptionEnabled).toBe(true);
    await act(async () => subscriptionSwitch()!.click());
    expect(host.connectionCalls).toEqual([{ subscriptionEnabled: true }, { subscriptionEnabled: false }]);
    expect(subscriptionSwitch()!.getAttribute("aria-checked")).toBe("false");
  });

  it("stays off when main keeps it off", async () => {
    const host = fakeAssistantHost();
    host.assistant!.setConnection = async (update) => {
      host.connectionCalls.push(update);
      return host.assistant!.status();
    };
    await mount(host);
    await act(async () => subscriptionSwitch()!.click());
    expect(host.connectionCalls).toHaveLength(1);
    expect(subscriptionSwitch()!.getAttribute("aria-checked")).toBe("false");
  });

  it("isn't there in the browser or with an older preload", async () => {
    await mount(null);
    expect(subscriptionSwitch()).toBeNull();
    expect(document.body.textContent).not.toContain("awaiting Anthropic's permission");
    act(() => root.unmount());
    root = createRoot(container);
    const older = fakeAssistantHost();
    delete older.assistant!.setConnection;
    await mount(older);
    expect(subscriptionSwitch()).toBeNull();
  });
});
