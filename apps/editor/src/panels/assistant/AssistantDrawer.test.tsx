// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantStore } from "./assistantStore.ts";
import { AssistantDrawer } from "./AssistantDrawer.tsx";
import { fakeAssistantHost, usage, type FakeAssistantHost } from "./testing.ts";
import { ANTHROPIC_CONSOLE_KEYS_URL, ASSISTANT_KEY_SECRET } from "./types.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function mount(host: FakeAssistantHost | null, props: { onConnectClaude?: () => void; onClose?: () => void } = {}) {
  const store = createAssistantStore({ persistModel: false });
  await act(async () => {
    root.render(<AssistantDrawer host={host} store={store} {...props} />);
  });
  await flush();
  return store;
}

const buttonByText = (text: string | RegExp) => [...container.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? "")));
const buttonByLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

describe("AssistantDrawer", () => {
  it("shows a desktop-only notice in the browser, with a link to Connect Claude", async () => {
    const onConnectClaude = vi.fn();
    await mount(null, { onConnectClaude });
    expect(container.textContent).toContain("The Assistant runs in the Sonobe desktop app");
    expect(container.querySelector("textarea")).toBeNull();
    await click(buttonByText(/Connect Claude/));
    expect(onConnectClaude).toHaveBeenCalledTimes(1);
  });

  it("asks for an API key first, explains privacy, and links to the Console and Connect Claude", async () => {
    const host = fakeAssistantHost();
    const onConnectClaude = vi.fn();
    await mount(host, { onConnectClaude });

    expect(container.textContent).toContain("Use your own Anthropic API key");
    expect(container.textContent).toContain("never asks for your claude.ai login");
    expect(container.textContent).toContain("macOS Keychain");
    expect(container.querySelector("textarea")).toBeNull();

    await click(buttonByText(/console\.anthropic\.com/));
    expect(host.opened).toEqual([ANTHROPIC_CONSOLE_KEYS_URL]);

    await click(buttonByText("Connect Claude Desktop or Claude Code"));
    expect(onConnectClaude).toHaveBeenCalledTimes(1);

    const field = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(field.getAttribute("autocomplete")).toBe("off");
    typeInto(field, "sk-ant-admin01-abc");
    await act(async () => {
      field.form!.requestSubmit();
    });
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Admin API key");
    expect(host.secretsMap.size).toBe(0);

    typeInto(field, "sk-ant-api03-abcdefgh1234");
    await act(async () => {
      field.form!.requestSubmit();
    });
    await flush();
    expect(host.secretsMap.get(ASSISTANT_KEY_SECRET)).toBe("sk-ant-api03-abcdefgh1234");
    expect(container.textContent).toContain("What should we build?");
    expect(container.textContent).toContain("sk-ant-…1234");
  });

  it("disables saving when the keychain isn't available", async () => {
    await mount(fakeAssistantHost({ secretsAvailable: false }));
    expect(container.textContent).toContain("can't store a key securely");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.disabled).toBe(true);
  });

  it("chats: streams the reply, shows tool chips and Stop, and confirms deletions", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    let finish!: () => void;
    host.nextResult = (_request, emit) =>
      new Promise((resolve) => {
        emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
        emit({ type: "turn_started", runId: "r1", turn: 1 });
        emit({ type: "text_delta", runId: "r1", turn: 1, delta: "Adding a **Card**." });
        emit({ type: "tool_started", runId: "r1", toolUseId: "t1", name: "add_layers", title: "Add layers", detail: "Card" });
        emit({ type: "confirm_required", runId: "r1", confirmationId: "c1", toolUseId: "t2", title: "Delete 12 items?", message: "Deleting 12 items from main.", count: 12 });
        emit({ type: "usage", runId: "r1", usage: usage(45_000), limits: { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 } });
        finish = () => {
          emit({ type: "tool_finished", runId: "r1", toolUseId: "t1", name: "add_layers", status: "done", detail: "Added 1 layer", changedDocument: true });
          emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(45_000) });
          resolve({ runId: "r1", outcome: "completed", usage: usage(45_000) });
        };
      });
    await mount(host);

    const textarea = container.querySelector("textarea")!;
    typeInto(textarea, "Add a card");
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    expect(host.sent).toEqual([{ text: "Add a card", model: "claude-sonnet-5" }]);
    expect(container.querySelector(".sb-assistant-msg__user")?.textContent).toBe("Add a card");
    expect(container.querySelector(".sb-assistant-msg__md")?.textContent).toContain("Adding a Card.");
    const chip = container.querySelector(".sb-assistant-tool")!;
    expect(chip.getAttribute("data-status")).toBe("running");
    expect(chip.textContent).toContain("Add layers");
    expect(container.querySelector(".sb-assistant-usage__text")?.textContent).toContain("45K / 1.5M tokens");

    // Stop while running.
    await click(buttonByLabel("Stop"));
    expect(host.stops).toBe(1);

    // The deletion confirmation.
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete 12 items?");
    await click(buttonByText("Delete"));
    expect(host.confirmations).toEqual([["c1", true]]);
    expect(container.textContent).toContain("You allowed the deletion.");

    await act(async () => finish());
    await flush();
    expect(container.querySelector(".sb-assistant-tool")?.getAttribute("data-status")).toBe("done");
    expect(buttonByLabel("Stop")).toBeNull();
    expect(buttonByLabel("Send")).not.toBeNull();
  });

  it("sends a starter suggestion and starts a new chat", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    expect(host.sent[0]?.text).toBe("Explain how this prototype works");
    expect(container.textContent).toContain("Hello!");

    await click(buttonByLabel("New chat"));
    expect(host.resets).toBe(1);
    expect(container.textContent).toContain("What should we build?");
  });

  it("shows key errors with a way back to the key setup", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      emit({ type: "run_finished", runId: "r1", outcome: "error", error: { code: "invalid_key", message: "Anthropic didn't accept this API key." }, usage: usage() });
      return { runId: "r1", outcome: "error", error: { code: "invalid_key", message: "Anthropic didn't accept this API key." }, usage: usage() };
    };
    await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    expect(container.querySelector(".sb-assistant-notice[data-tone='error']")?.textContent).toContain("didn't accept this API key");
    await click(buttonByText(/API key/));
    expect(container.textContent).toContain("Key saved");
    await click(buttonByText("Back to chat"));
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
