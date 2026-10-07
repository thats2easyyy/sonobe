// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOps, createEmptyDocument, type Op } from "@sonobe/core";
import { appPanels } from "../../app/appPanels.ts";
import { getRegistry } from "../../state/registry.ts";
import { createAssistantStore } from "./assistantStore.ts";
import { AssistantDrawer } from "./AssistantDrawer.tsx";
import type { AssistantController } from "./controller.ts";
import { assistantEditor } from "./editorLink.ts";
import { createMentionIndex, mentionKey, type MentionTarget } from "./mentions.ts";
import { SubscriptionSetup } from "./SubscriptionSetup.tsx";
import { fakeAssistantHost, NOT_INSTALLED_MESSAGE, SIGNED_OUT_MESSAGE, signedIn, subscriptionStatus, usage, type FakeAssistantHost } from "./testing.ts";
import { ANTHROPIC_CONSOLE_KEYS_URL, ASSISTANT_KEY_SECRET, type AssistantSelectionContext } from "./types.ts";

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

/** The drawer's own text, without a portal's (menus, tooltips). */
const text = () => container.textContent ?? "";

async function mount(host: FakeAssistantHost | null, props: { onConnectClaude?: () => void; onClose?: () => void; seed?: (store: ReturnType<typeof createAssistantStore>) => void } = {}) {
  const store = createAssistantStore({ persistModel: false });
  props.seed?.(store);
  const { seed: _seed, ...rest } = props;
  await act(async () => {
    root.render(<AssistantDrawer host={host} store={store} {...rest} />);
  });
  await flush();
  return store;
}

const buttonByText = (text: string | RegExp) => [...container.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? "")));
/** The tooltip text a keyboard-focused element shows. */
const tooltipOf = (el: Element | null) => {
  act(() => (el as HTMLElement).focus());
  return document.querySelector('[role="tooltip"]')?.textContent ?? "";
};
const buttonByLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Past the frame the drawer waits for before it moves focus. */
const afterFrame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Holds every frame until run(): a slow machine, where the frame the drawer waits for comes after the person's next move. */
function holdFrames() {
  const held: FrameRequestCallback[] = [];
  const spy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => held.push(callback));
  return {
    run: () =>
      act(async () => {
        spy.mockRestore();
        for (const callback of held.splice(0)) callback(performance.now());
      }),
  };
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

describe("AssistantDrawer", () => {
  it("shows a desktop-only notice in the browser that points to Import Design", async () => {
    const onConnectClaude = vi.fn();
    await mount(null, { onConnectClaude });
    expect(container.textContent).toContain("The Assistant runs in the Sonobe desktop app");
    expect(container.textContent).toContain(
      "It uses your own Anthropic API key, kept in your computer's keychain, so it isn't available in the browser. Claude's live edits need the desktop app too. Here, ask Claude for a screen as HTML and paste it into File → Import Design.",
    );
    expect(container.textContent).not.toContain("over MCP");
    expect(container.querySelector("textarea")).toBeNull();
    await click(buttonByText("Import Design…"));
    expect(appPanels.getState().open).toBe("importDesign");
    expect(onConnectClaude).not.toHaveBeenCalled();
    appPanels.getState().hide();
  });

  it("asks for an API key first, explains privacy, and links to the Console and Connect Claude", async () => {
    const host = fakeAssistantHost();
    const onConnectClaude = vi.fn();
    await mount(host, { onConnectClaude });

    expect(container.textContent).toContain("Use your own Anthropic API key");
    expect(container.textContent).toContain("never asks for your claude.ai login");
    expect(container.textContent).toContain("When you chat, your messages, the parts of this prototype the Assistant reads, and any files it reads from a code folder you link are sent to Anthropic's API.");
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
    expect(tooltipOf(buttonByLabel("API key"))).toBe("API key · sk-ant-…1234");
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

  it("keeps an unsent message through the setup and a closed sheet, and drops it on New chat", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    const store = await mount(host);
    typeInto(container.querySelector("textarea")!, "Make the heart pop when tapped");
    expect(store.getState().draft).toBe("Make the heart pop when tapped");

    await click(buttonByLabel("API key"));
    expect(container.querySelector("textarea")).toBeNull();
    await click(buttonByText("Back to chat"));
    expect(container.querySelector("textarea")?.value).toBe("Make the heart pop when tapped");

    // The sheet unmounts when it closes; the draft is in the store, so it comes back with it.
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<AssistantDrawer host={host} store={store} />);
    });
    await flush();
    expect(container.querySelector("textarea")?.value).toBe("Make the heart pop when tapped");

    await click(buttonByText("Explain how this prototype works"));
    expect(store.getState().draft).toBe("Make the heart pop when tapped");
    await click(buttonByLabel("New chat"));
    expect(store.getState().draft).toBe("");
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("focuses the message field when it opens, after New chat and on returning from the setup", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    await mount(host);
    const field = () => container.querySelector("textarea")!;
    await afterFrame();
    expect(document.activeElement).toBe(field());

    await click(buttonByLabel("API key"));
    await afterFrame();
    expect(document.activeElement).toBe(container.querySelector('input[type="password"]'));
    await click(buttonByText("Back to chat"));
    await afterFrame();
    expect(document.activeElement).toBe(field());

    await click(buttonByText("Explain how this prototype works"));
    (document.activeElement as HTMLElement).blur();
    await click(buttonByLabel("New chat"));
    await afterFrame();
    expect(document.activeElement).toBe(field());
  });

  it("takes focus on opening even from a control elsewhere, but not from a question waiting for its answer", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }));
    await afterFrame();
    expect(document.activeElement).toBe(container.querySelector("textarea"));

    act(() => root.unmount());
    root = createRoot(container);
    outside.focus();
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }), {
      seed: (store) =>
        store.setState({ items: [{ kind: "confirm", id: "c1", runId: "r1", title: "Delete 3 layers?", message: "Claude wants to delete 3 layers.", count: 3, status: "pending", confirmKind: "delete" }] }),
    });
    await afterFrame();
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttonByText("Keep them"));
    outside.remove();
  });

  it("leaves focus where the person has put it by the time its frame comes, and never takes it from under a dialog", async () => {
    const opener = document.createElement("button");
    const palette = document.createElement("input");
    document.body.append(opener, palette);
    opener.focus();
    let frames = holdFrames();
    await mount(fakeAssistantHost());
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
    palette.focus();
    await frames.run();
    expect(document.activeElement).toBe(palette);

    act(() => root.unmount());
    root = createRoot(container);
    palette.blur();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }));
    await afterFrame();
    expect(document.activeElement).toBe(document.body);
    modal.remove();

    act(() => root.unmount());
    root = createRoot(container);
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }));
    await afterFrame();
    await click(buttonByText("Explain how this prototype works"));
    frames = holdFrames();
    await click(buttonByLabel("New chat"));
    palette.focus();
    await frames.run();
    expect(document.activeElement).toBe(palette);
    opener.remove();
    palette.remove();
  });

  it("puts the key field first in the setup and focuses it", async () => {
    await mount(fakeAssistantHost());
    await afterFrame();
    const field = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(document.activeElement).toBe(field);
    const order = [...container.querySelectorAll("h3, label, summary, .sb-assistant-callout__title")].map((el) => el.textContent?.trim());
    expect(order).toEqual(["Use your own Anthropic API key", "API key", "Details", "Prefer your Claude subscription?"]);
    expect(field.getAttribute("aria-describedby")).toBe(container.querySelector(".sb-assistant-privacy__summary")!.id);
    expect(container.querySelector(".sb-assistant-key__icon")).toBeNull();
  });

  it("says Claude is working while a reply runs, and keeps the draft", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    host.nextResult = (_request, emit) =>
      new Promise(() => {
        emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      });
    const store = await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    const field = container.querySelector("textarea")!;
    expect(field.getAttribute("placeholder")).toBe("Claude is working… Esc to stop");
    typeInto(field, "and make the button orange");
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(field.value).toBe("and make the button orange");
    expect(store.getState().draft).toBe("and make the button orange");
    expect(host.sent).toHaveLength(1);
  });

  it("keeps the header at one row and the key hint in the key button's tooltip, not in a strip over the empty chat", async () => {
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }));
    const header = container.querySelector(".sb-assistant__header")!;
    expect(header.querySelector(".sb-assistant__mark")).toBeNull();
    expect(header.querySelector(".sb-assistant__subtitle")).toBeNull();
    expect(header.querySelector(".sb-assistant__title")?.textContent).toBe("Assistant");
    expect(container.querySelector(".sb-assistant__subtitle")).toBeNull();
    expect(container.textContent).not.toContain("sk-ant-");
    expect(tooltipOf(buttonByLabel("API key"))).toBe("API key · sk-ant-…1234");
  });

  it("offers New chat on a notice that says to start one", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      emit({ type: "notice", runId: "r1", tone: "warn", message: "This chat used its 1,500K token budget. Start a new chat to keep going." });
      emit({ type: "run_finished", runId: "r1", outcome: "budget", usage: usage(1_500_000) });
      return { runId: "r1", outcome: "budget", usage: usage(1_500_000) };
    };
    await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    await click(container.querySelector(".sb-assistant-notice button"));
    expect(host.resets).toBe(1);
    expect(container.textContent).toContain("What should we build?");
  });

  it("describes the models compactly on the API key", async () => {
    await mount(fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" }));
    await click(container.querySelector('button[aria-label^="Model"]') ?? buttonByText(/Sonnet 5/));
    expect(document.body.textContent).toContain("Fast and capable · $2 in / $10 out per 1M tokens");
    expect(document.body.textContent).not.toContain("per million tokens");
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

describe("AssistantDrawer on the Claude subscription (experimental)", () => {
  const subscriptionOn = { connection: { subscriptionEnabled: true, provider: "subscription" as const } };
  const KEY = "sk-ant-api03-abcdefgh1234";
  let clipboard: string[];

  beforeEach(() => {
    clipboard = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => void clipboard.push(value) } });
  });

  const radios = () => [...container.querySelectorAll('[role="radio"]')].map((r) => [r.textContent, r.getAttribute("aria-checked")]);

  it("with the switch off, shows only today's key setup", async () => {
    const host = fakeAssistantHost();
    await mount(host);
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(text()).toContain("Use your own Anthropic API key");
    expect(text()).toContain("Prefer your Claude subscription?");
    expect(text()).not.toContain("Use your Claude subscription");
    expect(host.checks).toBe(0);
  });

  it("with the switch on, offers the subscription and the API key, and picking one tells main", async () => {
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: true } });
    host.nextCheck = () => subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in", message: SIGNED_OUT_MESSAGE });
    await mount(host);
    expect(radios()).toEqual([
      ["Claude subscriptionExperimental", "false"],
      ["API key", "true"],
    ]);
    expect(text()).toContain("Use your own Anthropic API key");

    await click(container.querySelector('[role="radio"]'));
    expect(host.connectionCalls).toEqual([{ provider: "subscription" }]);
    expect(radios()[0]).toEqual(["Claude subscriptionExperimental", "true"]);
    expect(text()).toContain("Use your Claude subscription");
    expect(text()).toContain("It draws on your plan's usage limits. No API key.");
    expect(text()).toContain("Sonobe never sees your Claude login: the adapter uses the one Claude Code keeps on this computer.");
    expect(text()).toContain("Experimental: awaiting Anthropic's permission, so it's off by default and not in any release.");
    // Picking it read the login: signed out.
    expect(host.checks).toBe(1);
    expect(text()).toContain(SIGNED_OUT_MESSAGE);
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Claude subscription · not signed in");
  });

  it("signs in through Terminal, says what happened, and checks again", async () => {
    const host = fakeAssistantHost(subscriptionOn);
    host.nextCheck = () => subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in", message: SIGNED_OUT_MESSAGE });
    await mount(host);
    expect(text()).toContain(SIGNED_OUT_MESSAGE);
    await click(buttonByText("Sign in…"));
    expect(host.signIns).toBe(1);
    expect(text()).toContain("Finish signing in from Terminal, then choose Check again.");

    host.nextSignIn = () => ({ ok: false, error: "Run claude-agent-acp --cli auth login in a terminal, then check again." });
    await click(buttonByText("Sign in…"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Run claude-agent-acp --cli auth login in a terminal, then check again.");

    // Signed in meanwhile: Check again finds it, and the chat opens. While it looks, the setup stays, with its spinner.
    let answer!: () => void;
    host.assistant!.checkSubscription = () =>
      new Promise((resolve) => {
        host.checks++;
        answer = () => resolve(signedIn());
      });
    await click(buttonByText("Check again"));
    expect(host.checks).toBe(2);
    expect(text()).toContain("Checking Claude…");
    expect(text()).toContain("Use your Claude subscription");
    expect(text()).not.toContain("What should we build?");
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => answer());
    await flush();
    expect(text()).toContain("What should we build?");
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Claude Max · subscription");
  });

  it("shows the install command when the adapter isn't there, and copies it", async () => {
    const host = fakeAssistantHost(subscriptionOn);
    host.nextCheck = () => subscriptionStatus({ state: "not_installed", message: NOT_INSTALLED_MESSAGE });
    await mount(host);
    expect(text()).toContain("Install Claude's agent adapter (it needs Node.js 22 or later):");
    expect(container.querySelector(".sb-assistant-sub__command code")?.textContent).toBe("npm install -g @agentclientprotocol/claude-agent-acp");
    await click(buttonByText("Copy"));
    expect(clipboard).toEqual(["npm install -g @agentclientprotocol/claude-agent-acp"]);
    expect(buttonByText("Copied")).toBeTruthy();
    expect(buttonByText("Check again")).toBeTruthy();
  });

  it("says why the adapter didn't start, with Check again", async () => {
    const host = fakeAssistantHost(subscriptionOn);
    host.nextCheck = () => subscriptionStatus({ state: "failed", message: "Claude's agent adapter didn't start: spawn EACCES. Check that it's installed (npm install -g @agentclientprotocol/claude-agent-acp), then try again." });
    await mount(host);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("didn't start: spawn EACCES");
    expect(buttonByText("Check again")).toBeTruthy();
    expect(buttonByText("Sign in…")).toBeUndefined();
  });

  it("warns when the adapter bills an API key instead of the plan", async () => {
    const host = fakeAssistantHost(subscriptionOn);
    host.nextCheck = () => subscriptionStatus({ state: "ready", kind: "api_key", label: "Anthropic API key", adapterVersion: "0.79.0" });
    const store = await mount(host);
    // Ready: the chat shows; the header opens the setup.
    expect(text()).toContain("What should we build?");
    await click(buttonByLabel("Claude subscription"));
    expect(store.getState().setup).toBe(true);
    expect(text()).toContain("Claude's adapter is set to use Anthropic API key, so this bills that, not your Claude plan.");
    expect(text()).toContain("Claude's agent adapter 0.79.0");
    await click(buttonByText("Use Claude subscription"));
    expect(text()).toContain("What should we build?");
  });

  it("doesn't say signed in when the adapter never said which login it uses", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: subscriptionStatus({ state: "ready", adapterVersion: "0.79.0" }) });
    await mount(host);
    await click(buttonByLabel("Claude subscription"));
    expect(text()).toContain("Claude's agent adapter is running, but it didn't say which Claude account it uses. If it isn't signed in, your first message will say so.");
    expect(text()).not.toContain("Signed in");
    expect(container.querySelector(".sb-assistant-key__ok")).toBeNull();
    expect(buttonByText("Check again")).toBeTruthy();
    expect(buttonByText("Use Claude subscription")).toBeTruthy();
  });

  it("asks for the login when main says it's still being read, instead of spinning", async () => {
    // Another window's check was running when this window read the status.
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: subscriptionStatus({ state: "checking" }) });
    const store = await mount(host);
    expect(host.checks).toBe(1);
    expect(store.getState().status?.subscription).toMatchObject({ state: "ready", label: "Claude Max" });
  });

  it("says what pays when it isn't the plan: the header, the meter and the models", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: subscriptionStatus({ state: "ready", kind: "api_key", label: "Anthropic API key", adapterVersion: "0.79.0" }) });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" });
      emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(21_500) });
      return { runId: "r1", outcome: "completed", usage: usage(21_500) };
    };
    await mount(host);
    const subtitle = container.querySelector(".sb-assistant__subtitle")!;
    // What pays comes first, so a narrow header doesn't cut it; the tooltip has it all.
    expect(subtitle.textContent).toBe("Billed to Anthropic API key");
    expect(subtitle.getAttribute("data-tone")).toBe("warn");
    expect(subtitle.hasAttribute("title")).toBe(false);
    expect(tooltipOf(subtitle)).toBe("Claude subscription · billed to Anthropic API key");
    await click(buttonByText("Explain how this prototype works"));
    expect(container.querySelector(".sb-assistant-usage__text")?.textContent).toBe("22K tokens · billed to Anthropic API key");
    expect(tooltipOf(container.querySelector(".sb-assistant-usage"))).toContain("not your Claude plan");
    await click(container.querySelector('button[aria-label^="Model"]') ?? buttonByText(/Sonnet 5/));
    expect(document.body.textContent).toContain("Billed to Anthropic API key.");
    expect(document.body.textContent).not.toContain("Uses your Claude plan's limits.");
  });

  it("puts the plan first in the header, and has nothing more to say on hover when it fits", async () => {
    await mount(fakeAssistantHost({ ...subscriptionOn, subscription: signedIn() }));
    const subtitle = container.querySelector(".sb-assistant__subtitle")!;
    expect(subtitle.textContent).toBe("Claude Max · subscription");
    expect(subtitle.hasAttribute("title")).toBe(false);
    expect(subtitle.getAttribute("data-tone")).toBeNull();
  });

  it("with the switch on, the API key's setup points to the subscription beside it", async () => {
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: true } });
    await mount(host);
    expect(text()).toContain("Use your own Anthropic API key");
    expect(text()).not.toContain("never asks for your claude.ai login");
    expect(text()).toContain("Sonobe never reads Claude credentials.");
    expect(text()).toContain("Choose Claude subscription above, or connect Claude Desktop or Claude Code to Sonobe");
  });

  it("keeps focus in the field through a permission card, so Escape still stops the reply", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: signedIn() });
    host.nextResult = (_request, emit) =>
      new Promise(() => {
        emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" });
        emit({
          type: "confirm_required",
          runId: "r1",
          confirmationId: "p1",
          toolUseId: "toolu_1",
          kind: "permission",
          title: "Allow Claude to save this prototype?",
          message: "Claude wants to save this prototype. Claude Code asks before steps that reach outside this prototype.",
          count: 0,
          options: [
            { id: "allow-once", label: "Allow", kind: "allow_once" },
            { id: "reject", label: "Don't allow", kind: "reject_once" },
          ],
        });
      });
    await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    // The suggestion left focus in the message field, and a question doesn't take it from there.
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(buttonByText("Allow"));
    expect(host.confirmations).toEqual([["p1", true, "allow-once"]]);
    expect(container.querySelector(".sb-assistant-confirm__result")?.textContent).toBe("Allowed");
    const field = container.querySelector("textarea")!;
    expect(document.activeElement).toBe(field);
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(host.stops).toBe(1);
  });

  it("chats on the plan: its label in the header, tokens only, and the plan's limits on the models", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: signedIn() });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" });
      emit({ type: "turn_started", runId: "r1", turn: 1 });
      emit({ type: "text_delta", runId: "r1", turn: 1, delta: "Hello!" });
      emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: { ...usage(21_500), estimatedCostUsd: 0 } });
      return { runId: "r1", outcome: "completed", usage: usage(21_500) };
    };
    await mount(host);
    expect(host.checks).toBe(0);
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Claude Max · subscription");
    expect(buttonByLabel("API key")).toBeNull();
    await click(buttonByText("Explain how this prototype works"));
    expect(container.querySelector(".sb-assistant-usage__text")?.textContent).toBe("22K tokens · your Claude plan");
    expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(container.querySelector(".sb-assistant-provider-note")).toBeNull();

    await click(container.querySelector('button[aria-label^="Model"]') ?? buttonByText(/Sonnet 5/));
    expect(document.body.textContent).toContain("Uses your Claude plan's limits.");
    expect(document.body.textContent).not.toContain("per million tokens");
  });

  it("says when this chat runs on something else than a new one would, with New chat", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, key: KEY, subscription: signedIn() });
    // This window's chat started on the API key; another window then picked the subscription.
    host.chatProvider = "api_key";
    await mount(host);
    await click(buttonByText("Explain how this prototype works"));
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Your API key · sk-ant-…1234");
    const note = container.querySelector(".sb-assistant-provider-note");
    expect(note?.textContent).toBe("This chat uses your API key. A new chat uses your Claude subscription. New chat");
    await click(note!.querySelector("button"));
    expect(host.resets).toBe(1);
    expect(container.querySelector(".sb-assistant-provider-note")).toBeNull();
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Claude Max · subscription");
  });

  it("goes to the key's setup when a check answers unknown because another window turned the switch off", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: signedIn() });
    await mount(host);
    await click(buttonByLabel("Claude subscription"));
    expect(text()).toContain("Signed in · Claude Max");
    // Window B turns the switch off while this check runs: main's shutdown turns it into "unknown".
    host.nextCheck = () => {
      host.connection = { ...host.connection, subscriptionEnabled: false, active: "api_key" };
      return subscriptionStatus();
    };
    await click(buttonByText("Check again"));
    expect(host.checks).toBe(1);
    expect(text()).not.toContain("Checking Claude…");
    expect(text()).toContain("Use your own Anthropic API key");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("shows a subscription chat whose switch another window turned off, with New chat, rather than a setup that can't fix it", async () => {
    // This window's message failed not signed in; then window B turned the switch off (main reset only B's chat).
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: false, provider: "subscription" }, key: KEY, subscription: subscriptionStatus({ state: "signed_out", kind: "none", label: "Claude Max", message: SIGNED_OUT_MESSAGE }) });
    host.chatProvider = "subscription";
    await mount(host);
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(text()).not.toContain("Use your own Anthropic API key");
    expect(container.querySelector(".sb-assistant-provider-note")?.textContent).toBe("This chat uses your Claude subscription. A new chat uses your API key. New chat");
    expect(buttonByLabel("New chat")).not.toBeNull();
    // The header's setup button opens what a new chat needs, and Back to chat comes back.
    expect(buttonByLabel("Claude subscription")).toBeNull();
    await click(buttonByLabel("API key"));
    expect(text()).toContain("Use your own Anthropic API key");
    await click(buttonByText("Back to chat"));
    expect(container.querySelector("textarea")).not.toBeNull();
    // New chat moves to the API key.
    await click(container.querySelector(".sb-assistant-provider-note button"));
    expect(host.resets).toBe(1);
    expect(container.querySelector(".sb-assistant-provider-note")).toBeNull();
    expect(container.querySelector(".sb-assistant__subtitle")).toBeNull();
    expect(tooltipOf(buttonByLabel("API key"))).toBe("API key · sk-ant-…1234");
  });

  it("focuses the first button of a setup that has no field", async () => {
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: subscriptionStatus({ state: "signed_out", kind: "none", label: "Claude", email: null, message: SIGNED_OUT_MESSAGE }) });
    await mount(host);
    await afterFrame();
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("says not signed in in the header while signed out, whatever plan the last login named", async () => {
    // A signed-in chat's next message failed with auth_required: the status can still carry the old plan's label.
    const host = fakeAssistantHost({ ...subscriptionOn, subscription: subscriptionStatus({ state: "signed_out", kind: "none", label: "Claude Max", email: null, message: SIGNED_OUT_MESSAGE }) });
    host.nextCheck = () => host.subscription;
    await mount(host);
    expect(text()).toContain(SIGNED_OUT_MESSAGE);
    const subtitle = container.querySelector(".sb-assistant__subtitle")!;
    expect(subtitle.textContent).toBe("Claude subscription · not signed in");
    expect(subtitle.hasAttribute("title")).toBe(false);
    expect(subtitle.getAttribute("data-tone")).toBeNull();
  });
});

describe("SubscriptionSetup", () => {
  it("reads the login when it opens on a check it didn't start, sharing one that's running", async () => {
    const checks = vi.fn(async () => signedIn());
    const controller = { checkSubscription: checks, signInToClaude: vi.fn() } as unknown as AssistantController;
    await act(async () => {
      root.render(<SubscriptionSetup controller={controller} subscription={subscriptionStatus({ state: "checking" })} />);
    });
    expect(checks).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Checking Claude…");
  });

  it("stops spinning when its check comes back unknown, and offers Check again", async () => {
    // Main answered "unknown": its switch went off during the check, or it couldn't tell. Nothing else reads the status here.
    const checks = vi.fn(async () => subscriptionStatus());
    const controller = { checkSubscription: checks, signInToClaude: vi.fn() } as unknown as AssistantController;
    await act(async () => {
      root.render(<SubscriptionSetup controller={controller} subscription={subscriptionStatus()} />);
    });
    await flush();
    expect(checks).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Checking Claude…");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Sonobe couldn't check Claude's login this time. Choose Check again.");
    const again = buttonByText("Check again")!;
    expect(again.disabled).toBe(false);
    await click(again);
    expect(checks).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Sonobe couldn't check Claude's login this time.");
    // Another check (the box's, another window's) shows the spinner while it runs, and its answer shows.
    await act(async () => {
      root.render(<SubscriptionSetup controller={controller} subscription={subscriptionStatus({ state: "checking" })} />);
    });
    expect(text()).toContain("Checking Claude…");
    expect(checks).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.render(<SubscriptionSetup controller={controller} subscription={signedIn()} />);
    });
    expect(text()).toContain("Signed in · Claude Max · ava@example.com");
    // Unknown again later (the switch went off and on): it reads the login on its own again.
    await act(async () => {
      root.render(<SubscriptionSetup controller={controller} subscription={subscriptionStatus()} />);
    });
    await flush();
    expect(checks).toHaveBeenCalledTimes(3);
  });
});

describe("AssistantDrawer and the editor's selection", () => {
  const KEY = "sk-ant-api03-abcdefgh1234";
  const registry = getRegistry();
  const ops: Op[] = [
    { op: "addKnob", knob: { id: "flight_time", name: "Flight Time", type: "number", value: 0.6 } },
    { op: "addLayer", layer: { id: "level_line", type: "rectangle", name: "Level Line", props: {} } },
    { op: "addPatch", patch: { id: "flight_timer", type: "wait", name: "Flight Timer", inputs: {} } },
    { op: "addPatch", patch: { id: "flight_ease", type: "curve", name: "Flight Easing", inputs: {} } },
  ];
  const built = applyOps(createEmptyDocument({ name: "Camera Demo" }), ops, { registry });
  if (!built.ok) throw new Error(built.errors[0]?.message);
  const doc = built.doc;
  const main = doc.project.root;
  const timer: AssistantSelectionContext = { component: { id: main, name: "Main" }, items: [{ kind: "patch", id: "flight_timer", name: "Flight Timer", type: "wait" }] };
  const both: AssistantSelectionContext = { ...timer, items: [...timer.items, { kind: "layer", id: "level_line", name: "Level Line", type: "rectangle" }] };

  let shown: MentionTarget[];
  let pointed: (MentionTarget | null)[];
  /** What attachAssistantEditor keeps in the store, set by hand: the drawer reads only the store. */
  const editor = (selection: AssistantSelectionContext | null) =>
    act(() => {
      assistantEditor.setState({
        selection,
        index: createMentionIndex({ doc, registry, current: main }),
        selected: new Set((selection?.items ?? []).map((i) => mentionKey({ kind: i.kind, id: i.id, component: main }))),
        show: (target) => shown.push(target),
        point: (target) => pointed.push(target),
      });
    });
  const row = () => container.querySelector(".sb-assistant-selection");
  const chips = (root: Element | null) => [...(root?.querySelectorAll(".sb-mention") ?? [])].map((chip) => chip.textContent);
  const field = () => container.querySelector("textarea")!;
  const send = async (text: string) => {
    typeInto(field(), text);
    await act(async () => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
  };

  beforeEach(() => {
    shown = [];
    pointed = [];
  });
  afterEach(() => {
    act(() => assistantEditor.setState({ selection: null, index: null, selected: new Set(), show: () => undefined, point: () => undefined }, true));
  });

  it("shows nothing over the message field without a selection, or without an editor", async () => {
    await mount(fakeAssistantHost({ key: KEY }));
    expect(row()).toBeNull();
    expect(field().placeholder).toBe("Describe what to build or ask a question…");
    editor(null);
    expect(row()).toBeNull();
  });

  it("shows what's selected over the message field, and sends it with the message", async () => {
    const host = fakeAssistantHost({ key: KEY });
    editor(both);
    await mount(host);
    expect(row()?.getAttribute("aria-label")).toBe("Goes with your message: Flight Timer and Level Line");
    expect(chips(row())).toEqual(["Flight Timer", "Level Line"]);
    expect(field().placeholder).toBe("Ask about the selection or describe a change…");

    await send("why two of them?");
    expect(host.sent).toEqual([{ text: "why two of them?", model: "claude-sonnet-5", selection: both }]);
    // The message keeps the chips it went with, and they still show the items.
    const about = container.querySelector(".sb-assistant-msg[data-role='user'] .sb-assistant-msg__about");
    expect(about?.getAttribute("aria-label")).toBe("Sent with Flight Timer and Level Line selected");
    expect(chips(about)).toEqual(["Flight Timer", "Level Line"]);
    await click(about?.querySelector(".sb-mention"));
    expect(shown).toEqual([expect.objectContaining({ kind: "patch", id: "flight_timer", component: main, typeName: "Wait" })]);
  });

  it("asks about the selection from the starters and from Explain", async () => {
    const host = fakeAssistantHost({ key: KEY });
    editor(timer);
    await mount(host);
    expect([...container.querySelectorAll(".sb-assistant-suggestion")].map((b) => b.textContent)).toEqual(["What does this do?", "How does this work?", "What's happening here?"]);
    await click(buttonByText("How does this work?"));
    expect(host.sent[0]).toEqual({ text: "How does this work?", model: "claude-sonnet-5", selection: timer });

    expect(tooltipOf(buttonByText("Explain")!)).toBe("Asks “What does this do, and how does it work?”");
    await click(buttonByText("Explain"));
    expect(host.sent[1]).toEqual({ text: "What does this do, and how does it work?", model: "claude-sonnet-5", selection: timer });

    editor(both);
    await click(buttonByText("Explain"));
    expect(host.sent[2]).toEqual({ text: "What do these do, and how do they work together?", model: "claude-sonnet-5", selection: both });
  });

  it("leaves the selection out after ×, until something else is selected", async () => {
    const host = fakeAssistantHost({ key: KEY });
    editor(timer);
    const store = await mount(host);
    await click(buttonByLabel("Leave the selection out of the message"));
    expect(row()).toBeNull();
    expect([...container.querySelectorAll(".sb-assistant-suggestion")].map((b) => b.textContent)).toContain("Explain how this prototype works");
    await send("add a counter");
    expect(host.sent).toEqual([{ text: "add a counter", model: "claude-sonnet-5" }]);
    expect(container.querySelector(".sb-assistant-msg__about")).toBeNull();

    // The same selection again (a re-render) stays off; another one shows.
    editor({ ...timer, items: [{ ...timer.items[0]! }] });
    expect(row()).toBeNull();
    editor(both);
    expect(chips(row())).toEqual(["Flight Timer", "Level Line"]);
    editor(timer);
    expect(row()).toBeNull();
    // Asking about it (Explain with Claude) puts it back.
    act(() => store.getState().setSelectionOff(null));
    expect(chips(row())).toEqual(["Flight Timer"]);
  });

  it("hides Explain while a reply runs, and keeps the chips", async () => {
    const host = fakeAssistantHost({ key: KEY });
    let finish: () => void = () => undefined;
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      return new Promise((resolve) => {
        finish = () => {
          emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(10) });
          resolve({ runId: "r1", outcome: "completed", usage: usage(10) });
        };
      });
    };
    editor(timer);
    await mount(host);
    await send("what is this?");
    expect(chips(row())).toEqual(["Flight Timer"]);
    expect(buttonByText("Explain")).toBeUndefined();
    expect(field().placeholder).toBe("Claude is working… Esc to stop");
    await act(async () => finish());
    await flush();
    expect(buttonByText("Explain")).toBeTruthy();
  });

  it("draws the names in a reply as chips that select and point at the item", async () => {
    const host = fakeAssistantHost({ key: KEY });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      emit({ type: "turn_started", runId: "r1", turn: 1 });
      emit({ type: "text_delta", runId: "r1", turn: 1, delta: "[Flight Timer](#flight_timer) runs for the [Flight Time](#$knob.flight_time) knob, then Flight Easing smooths it and the [Level Line](#@level_line) turns. [Gone](#gone) and [docs](https://example.com)." });
      emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(10) });
      return { runId: "r1", outcome: "completed", usage: usage(10) };
    };
    editor(timer);
    await mount(host);
    await send("how does it work?");
    const reply = container.querySelector(".sb-assistant-msg[data-role='assistant']")!;
    expect(chips(reply)).toEqual(["Flight Timer", "Flight Time", "Flight Easing", "Level Line"]);
    expect([...reply.querySelectorAll(".sb-mention")].map((chip) => chip.getAttribute("data-kind"))).toEqual(["patch", "knob", "patch", "layer"]);
    // The selected item's chip says so; a link to nothing is its text, and a web link stays a link.
    expect([...reply.querySelectorAll(".sb-mention[data-selected]")].map((chip) => chip.textContent)).toEqual(["Flight Timer"]);
    expect(reply.textContent).toContain("Gone and docs.");
    expect([...reply.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://example.com"]);

    const [, knob, easing, line] = [...reply.querySelectorAll<HTMLElement>(".sb-mention")];
    expect(tooltipOf(easing!)).toBe("Select this Curve patch in the patch editor");
    expect(pointed.at(-1)).toMatchObject({ kind: "patch", id: "flight_ease" });
    act(() => easing!.blur());
    expect(pointed.at(-1)).toBeNull();
    await click(line);
    await click(knob);
    expect(shown).toEqual([expect.objectContaining({ kind: "layer", id: "level_line" }), { kind: "knob", id: "flight_time", name: "Flight Time" }]);
  });

  it("puts focus in the message field when something asks for it with the sheet already open", async () => {
    const store = await mount(fakeAssistantHost({ key: KEY }));
    await afterFrame();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).not.toBe(field());
    act(() => store.getState().ask());
    await afterFrame();
    expect(document.activeElement).toBe(field());
    expect(store.getState()).toMatchObject({ open: true, setup: false });
  });
});
