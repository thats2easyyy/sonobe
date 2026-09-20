// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appPanels } from "../../app/appPanels.ts";
import { createAssistantStore } from "./assistantStore.ts";
import { AssistantDrawer } from "./AssistantDrawer.tsx";
import type { AssistantController } from "./controller.ts";
import { SubscriptionSetup } from "./SubscriptionSetup.tsx";
import { fakeAssistantHost, NOT_INSTALLED_MESSAGE, SIGNED_OUT_MESSAGE, signedIn, subscriptionStatus, usage, type FakeAssistantHost } from "./testing.ts";
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

/** The drawer's own text, without a portal's (menus, tooltips). */
const text = () => container.textContent ?? "";

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
    expect(container.querySelector(".sb-assistant__subtitle")?.textContent).toBe("Claude subscription · Not logged in");
  });

  it("signs in through Terminal, says what happened, and checks again", async () => {
    const host = fakeAssistantHost(subscriptionOn);
    host.nextCheck = () => subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in", message: SIGNED_OUT_MESSAGE });
    await mount(host);
    expect(text()).toContain(SIGNED_OUT_MESSAGE);
    await click(buttonByText("Sign in…"));
    expect(host.signIns).toBe(1);
    expect(text()).toContain("Finish signing in in Terminal, then choose Check again.");

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
    expect(subtitle.getAttribute("title")).toBe("Claude subscription · billed to Anthropic API key");
    await click(buttonByText("Explain how this prototype works"));
    expect(container.querySelector(".sb-assistant-usage__text")?.textContent).toBe("22K tokens · billed to Anthropic API key");
    expect(container.querySelector(".sb-assistant-usage")?.getAttribute("title")).toContain("not your Claude plan");
    await click(container.querySelector('button[aria-label^="Model"]') ?? buttonByText(/Sonnet 5/));
    expect(document.body.textContent).toContain("Billed to Anthropic API key.");
    expect(document.body.textContent).not.toContain("Uses your Claude plan's limits.");
  });

  it("puts the plan first in the header, and says the whole subtitle on hover", async () => {
    await mount(fakeAssistantHost({ ...subscriptionOn, subscription: signedIn() }));
    const subtitle = container.querySelector(".sb-assistant__subtitle")!;
    expect(subtitle.textContent).toBe("Claude Max · subscription");
    expect(subtitle.getAttribute("title")).toBe("Claude Max · subscription");
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

  it("moves focus to the field once a permission card is answered, so Escape still stops the reply", async () => {
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
    expect(document.activeElement).toBe(container.querySelector('[role="alertdialog"]'));
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
});
