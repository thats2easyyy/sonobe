import { describe, expect, it } from "vitest";
import { createAssistantStore } from "./assistantStore.ts";
import { createAssistantController } from "./controller.ts";
import { fakeAssistantHost, NOT_INSTALLED_MESSAGE, SIGNED_OUT_MESSAGE, signedIn, subscriptionStatus, usage } from "./testing.ts";
import { ANTHROPIC_CONSOLE_KEYS_URL, ASSISTANT_KEY_SECRET, type AssistantCanvasContext } from "./types.ts";

describe("assistant controller", () => {
  it("is unavailable in the browser and does nothing", async () => {
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(null, store);
    expect(controller.available).toBe(false);
    expect(await controller.send("hi")).toBeNull();
    expect(await controller.saveKey("sk-ant-api03-abc")).toMatchObject({ ok: false });
    expect(store.getState().items).toEqual([]);
    // An older preload with secrets but no assistant bridge is also unavailable.
    expect(createAssistantController({ secrets: fakeAssistantHost().secrets! }, store).available).toBe(false);
  });

  it("saves a key to sonobeHost.secrets, refreshes, and checks it", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    expect(store.getState().status).toMatchObject({ hasKey: false });

    expect(await controller.saveKey("sk-ant-admin01-nope")).toMatchObject({ ok: false, message: expect.stringContaining("Admin") });
    expect(host.secretsMap.size).toBe(0);

    expect(await controller.saveKey("  sk-ant-api03-abcdefgh1234 ")).toEqual({ ok: true });
    expect(host.secretsMap.get(ASSISTANT_KEY_SECRET)).toBe("sk-ant-api03-abcdefgh1234");
    expect(store.getState().status).toMatchObject({ hasKey: true, keyHint: "sk-ant-…1234" });
    expect(store.getState().keyCheck).toEqual({ state: "ok" });

    host.keyOk = false;
    expect(await controller.saveKey("sk-ant-api03-wrongwrong99")).toMatchObject({ ok: false, message: "Anthropic didn't accept this API key." });

    await controller.removeKey();
    expect(host.secretsMap.size).toBe(0);
    expect(store.getState().status?.hasKey).toBe(false);
    expect(store.getState().keyCheck).toEqual({ state: "idle" });
  });

  it("reports keychain failures instead of pretending the key was saved", async () => {
    const host = fakeAssistantHost({ secretsAvailable: false });
    const controller = createAssistantController(host, createAssistantStore({ persistModel: false }));
    expect(await controller.saveKey("sk-ant-api03-abcdefgh1234")).toMatchObject({ ok: false, message: expect.stringContaining("couldn't save") });
  });

  it("sends with the chosen model and folds streamed events into the transcript", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    store.getState().setModel("claude-opus-5");
    const result = await controller.send("  Add a card  ");
    expect(result?.outcome).toBe("completed");
    expect(host.sent).toEqual([{ text: "Add a card", model: "claude-opus-5" }]);
    expect(store.getState().items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(store.getState().items[1]).toMatchObject({ text: "Hello!" });
    expect(store.getState()).toMatchObject({ running: false, usage: { totalTokens: 1200 } });
    expect(await controller.send("   ")).toBeNull();
  });

  it("shows failures that happen before a run starts, and refreshes on key problems", async () => {
    const host = fakeAssistantHost();
    host.nextResult = () => ({ runId: "x", outcome: "error", error: { code: "no_key", message: "Add your Anthropic API key to use the Assistant." }, usage: usage() });
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.send("hello");
    expect(store.getState().running).toBe(false);
    expect(store.getState().items.at(-1)).toMatchObject({ kind: "notice", tone: "error", code: "no_key" });
    expect(store.getState().status).not.toBeNull();
  });

  it("recovers when the bridge rejects", async () => {
    const host = fakeAssistantHost();
    host.nextResult = () => {
      throw new Error("Untrusted sender");
    };
    const store = createAssistantStore({ persistModel: false });
    await createAssistantController(host, store).send("hi");
    expect(store.getState().running).toBe(false);
    expect(store.getState().items.at(-1)).toMatchObject({ kind: "notice", text: expect.stringContaining("Untrusted sender") });
  });

  it("doesn't send while a reply is running, and stops it", async () => {
    const host = fakeAssistantHost();
    let finish!: () => void;
    host.nextResult = (_req, emit) =>
      new Promise((resolve) => {
        emit({ type: "run_started", runId: "r9", model: "claude-sonnet-5" });
        finish = () => {
          emit({ type: "run_finished", runId: "r9", outcome: "stopped", usage: usage() });
          resolve({ runId: "r9", outcome: "stopped", usage: usage() });
        };
      });
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    const pending = controller.send("long job");
    await Promise.resolve();
    expect(store.getState().running).toBe(true);
    expect(await controller.send("another")).toBeNull();
    await controller.stop();
    expect(host.stops).toBe(1);
    finish();
    await pending;
    expect(store.getState().running).toBe(false);
    expect(host.sent).toHaveLength(1);
  });

  it("answers confirmations optimistically, starts new chats, and opens the Console", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    host.emit({ type: "confirm_required", runId: "r1", confirmationId: "c1", toolUseId: "t1", title: "Delete 12 items?", message: "…", count: 12 });
    await controller.confirm("c1", false);
    expect(host.confirmations).toEqual([["c1", false]]);
    expect(store.getState().items.at(-1)).toMatchObject({ kind: "confirm", status: "declined" });

    await controller.newChat();
    expect(host.resets).toBe(1);
    expect(store.getState().items).toEqual([]);

    controller.openConsole();
    expect(host.opened).toEqual([ANTHROPIC_CONSOLE_KEYS_URL]);

    controller.dispose();
    host.emit({ type: "notice", runId: "r1", tone: "info", message: "after dispose" });
    expect(store.getState().items).toEqual([]);
    expect(host.listeners.size).toBe(0);
  });

  it("re-attaches after dispose, as React StrictMode remounts do", () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    controller.attach();
    expect(host.listeners.size).toBe(1);
    controller.dispose();
    controller.attach();
    expect(host.listeners.size).toBe(1);
    host.emit({ type: "notice", runId: "r1", tone: "info", message: "still listening" });
    expect(store.getState().items).toEqual([expect.objectContaining({ kind: "notice", text: "still listening" })]);
  });

  it("sends the canvas's context with a message from the Design with Claude box, and tags it", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    const context: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
    await controller.send(" a checkout ", { context });
    expect(host.sent).toEqual([{ text: "a checkout", model: "claude-sonnet-5", context }]);
    expect(store.getState().items[0]).toMatchObject({ kind: "user", text: "a checkout", origin: "canvas" });

    await controller.send("and a promo code");
    expect(host.sent[1]).toEqual({ text: "and a promo code", model: "claude-sonnet-5" });
    expect(store.getState().items.filter((i) => i.kind === "user")[1]).toEqual({ kind: "user", id: expect.any(String), text: "and a promo code" });
  });

  it("reads, links and unlinks the code folder into the status", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    expect(store.getState().status?.codeFolder).toEqual({ linked: null, missing: false });

    const linked = await controller.linkCodeFolder();
    expect(linked).toEqual({ status: { linked: { name: "noddit", path: "~/code/noddit", persisted: true }, missing: false } });
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("noddit");

    host.nextLink = () => ({ status: host.folder, cancelled: true });
    expect(await controller.linkCodeFolder()).toMatchObject({ cancelled: true });
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("noddit");

    host.nextLink = () => ({ status: host.folder, error: "Pick your app's folder, not your whole home folder." });
    expect(await controller.linkCodeFolder()).toMatchObject({ error: "Pick your app's folder, not your whole home folder." });

    host.folder = { linked: { name: "noddit", path: "~/code/noddit", persisted: true }, missing: true };
    expect(await controller.codeFolder()).toMatchObject({ missing: true });
    expect(store.getState().status?.codeFolder?.missing).toBe(true);

    expect(await controller.unlinkCodeFolder()).toEqual({ linked: null, missing: false });
    expect(store.getState().status?.codeFolder).toEqual({ linked: null, missing: false });
    expect(host.folderCalls).toEqual(["link", "link", "link", "codeFolder", "unlink"]);
  });

  it("does nothing with the code folder when the host can't link one", async () => {
    expect(await createAssistantController(null, createAssistantStore({ persistModel: false })).linkCodeFolder()).toBeNull();
    const host = fakeAssistantHost();
    const { codeFolder: _read, linkCodeFolder: _link, unlinkCodeFolder: _unlink, ...olderBridge } = host.assistant!;
    const controller = createAssistantController({ ...host, assistant: olderBridge }, createAssistantStore({ persistModel: false }));
    expect(controller.available).toBe(true);
    expect(await controller.codeFolder()).toBeNull();
    expect(await controller.linkCodeFolder()).toBeNull();
    expect(await controller.unlinkCodeFolder()).toBeNull();
  });

  it("says why a folder couldn't be linked when the bridge rejects", async () => {
    const host = fakeAssistantHost();
    host.nextLink = () => {
      throw new Error("Untrusted sender");
    };
    const controller = createAssistantController(host, createAssistantStore({ persistModel: false }));
    expect(await controller.linkCodeFolder()).toEqual({ status: { linked: null, missing: false }, error: "Sonobe couldn't link the folder: Untrusted sender" });
  });

  it("opens Claude Code on macOS with the prompt, needing no key, and reads the folder it linked", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    expect(controller.canOpenInClaudeCode).toBe(true);
    expect(await controller.openInClaudeCode("In my open Sonobe prototype “Noddit”, design a new screen")).toEqual({ ok: true, folder: "~/code/noddit" });
    expect(host.handoffs).toEqual(["In my open Sonobe prototype “Noddit”, design a new screen"]);
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("noddit");
    expect(host.sent).toEqual([]);

    host.nextHandoff = () => ({ ok: false, cancelled: true });
    expect(await controller.openInClaudeCode("a new screen")).toEqual({ ok: false, cancelled: true });
    // A cancelled dialog linked nothing, so there's nothing to read again.
    expect(host.folderCalls).toEqual(["codeFolder"]);

    host.nextHandoff = () => {
      throw new Error("No handler registered for 'sonobe:assistant:open-claude-code'");
    };
    expect(await controller.openInClaudeCode("a new screen")).toEqual({ ok: false, error: "Sonobe couldn't open Claude Code: No handler registered for 'sonobe:assistant:open-claude-code'" });
  });

  it("offers Claude Code only when the host has it, on macOS or a host that doesn't say", async () => {
    expect(createAssistantController(null, createAssistantStore({ persistModel: false })).canOpenInClaudeCode).toBe(false);
    expect(await createAssistantController(null, createAssistantStore({ persistModel: false })).openInClaudeCode("a new screen")).toBeNull();
    const on = (platform: string | undefined, bridge = fakeAssistantHost().assistant!) => createAssistantController({ ...fakeAssistantHost(), platform, assistant: bridge }, createAssistantStore({ persistModel: false }));
    expect(on("darwin").canOpenInClaudeCode).toBe(true);
    expect(on(undefined).canOpenInClaudeCode).toBe(true);
    expect(on("win32").canOpenInClaudeCode).toBe(false);
    expect(on("linux").canOpenInClaudeCode).toBe(false);
    const { openInClaudeCode: _open, ...olderBridge } = fakeAssistantHost().assistant!;
    expect(on("darwin", olderBridge).canOpenInClaudeCode).toBe(false);
    expect(await on("darwin", olderBridge).openInClaudeCode("a new screen")).toBeNull();
  });

  it("keeps a stored model the host offers, else uses the host's default", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    store.getState().setModel("claude-opus-4-8");
    await createAssistantController(host, store).refresh();
    expect(store.getState().model).toBe("claude-sonnet-5");
  });
});

describe("assistant controller on the Claude subscription", () => {
  it("does nothing with the connection when the host can't", async () => {
    const host = fakeAssistantHost();
    delete host.assistant!.setConnection;
    delete host.assistant!.checkSubscription;
    delete host.assistant!.signInToClaude;
    const controller = createAssistantController(host, createAssistantStore({ persistModel: false }));
    expect(await controller.setConnection({ subscriptionEnabled: true })).toBeNull();
    expect(await controller.checkSubscription()).toBeNull();
    expect(await controller.signInToClaude()).toBeNull();
    // In the browser too.
    const browser = createAssistantController(null, createAssistantStore({ persistModel: false }));
    expect(await browser.setConnection({ provider: "subscription" })).toBeNull();
    expect(await browser.checkSubscription()).toBeNull();
    expect(await browser.signInToClaude()).toBeNull();
  });

  it("turns the switch on and picks the subscription, clearing the transcript only when what a new chat runs on changes", async () => {
    const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    expect(store.getState().status?.connection).toEqual({ subscriptionEnabled: false, provider: "api_key", active: "api_key" });
    await controller.send("hi");
    expect(store.getState().items).toHaveLength(2);

    // The switch alone doesn't change what a new chat runs on: the chat stays.
    const on = await controller.setConnection({ subscriptionEnabled: true });
    expect(on).toMatchObject({ ok: true, status: { connection: { subscriptionEnabled: true, provider: "api_key", active: "api_key" } } });
    expect(store.getState().items).toHaveLength(2);
    expect(host.checks).toBe(0);

    // Picking the subscription does: main reset the chat, and the login is read for the first time this launch.
    await controller.setConnection({ provider: "subscription" });
    expect(store.getState().items).toEqual([]);
    expect(store.getState().status?.connection?.active).toBe("subscription");
    await Promise.resolve();
    expect(host.checks).toBe(1);
    expect(host.connectionCalls).toEqual([{ subscriptionEnabled: true }, { provider: "subscription" }]);
  });

  it("says why the connection didn't change", async () => {
    const host = fakeAssistantHost();
    host.assistant!.setConnection = async () => {
      throw new Error("Untrusted sender");
    };
    const controller = createAssistantController(host, createAssistantStore({ persistModel: false }));
    expect(await controller.setConnection({ subscriptionEnabled: true })).toEqual({ ok: false, error: "Sonobe couldn't change the Assistant's connection: Untrusted sender" });
  });

  it("reads the login once for everyone who asks, showing it's checking meanwhile", async () => {
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: true, provider: "subscription" } });
    let answer!: () => void;
    host.assistant!.checkSubscription = () =>
      new Promise((resolve) => {
        host.checks++;
        answer = () => resolve(signedIn());
      });
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    // A refresh with the subscription active and unknown checks on its own.
    await controller.refresh();
    expect(host.checks).toBe(1);
    expect(store.getState().status?.subscription?.state).toBe("checking");
    const again = controller.checkSubscription();
    expect(host.checks).toBe(1);
    answer();
    expect(await again).toMatchObject({ state: "ready", label: "Claude Max" });
    expect(store.getState().status?.subscription).toMatchObject({ state: "ready", kind: "account", email: "ava@example.com" });
    // A later check asks again.
    void controller.checkSubscription();
    expect(host.checks).toBe(2);
  });

  it("doesn't check on refresh while the API key is what new chats use, or once the login is known", async () => {
    const off = fakeAssistantHost();
    await createAssistantController(off, createAssistantStore({ persistModel: false })).refresh();
    expect(off.checks).toBe(0);
    const known = fakeAssistantHost({ connection: { subscriptionEnabled: true, provider: "subscription" }, subscription: signedIn() });
    await createAssistantController(known, createAssistantStore({ persistModel: false })).refresh();
    expect(known.checks).toBe(0);
  });

  it("reports a check the bridge rejected as failed, with what happened", async () => {
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: true, provider: "subscription" }, subscription: signedIn() });
    host.assistant!.checkSubscription = async () => {
      throw new Error("IPC closed");
    };
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    expect(await controller.checkSubscription()).toMatchObject({ state: "failed", message: "Sonobe couldn't check Claude's login: IPC closed", adapterVersion: "0.79.0" });
    expect(store.getState().status?.subscription?.state).toBe("failed");
  });

  it("opens Claude's sign-in and passes its answer on", async () => {
    const host = fakeAssistantHost();
    const controller = createAssistantController(host, createAssistantStore({ persistModel: false }));
    expect(await controller.signInToClaude()).toEqual({ ok: true });
    host.nextSignIn = () => ({ ok: false, error: "Run claude-agent-acp --cli auth login in a terminal, then check again." });
    expect(await controller.signInToClaude()).toEqual({ ok: false, error: "Run claude-agent-acp --cli auth login in a terminal, then check again." });
    host.assistant!.signInToClaude = async () => {
      throw new Error("no Terminal");
    };
    expect(await controller.signInToClaude()).toEqual({ ok: false, error: "Sonobe couldn't open Terminal to sign in: no Terminal" });
    expect(host.signIns).toBe(2);
  });

  it("answers a permission card with the option picked", async () => {
    const host = fakeAssistantHost();
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" });
    host.emit({
      type: "confirm_required",
      runId: "r1",
      confirmationId: "p1",
      toolUseId: "toolu_1",
      kind: "permission",
      title: "Allow Claude to save this prototype?",
      message: "…",
      count: 0,
      options: [
        { id: "allow-once", label: "Allow", kind: "allow_once" },
        { id: "reject", label: "Don't allow", kind: "reject_once" },
      ],
    });
    await controller.confirm("p1", true, "allow-once");
    expect(host.confirmations).toEqual([["p1", true, "allow-once"]]);
    expect(store.getState().items.at(-1)).toMatchObject({ kind: "confirm", status: "approved", optionId: "allow-once" });
  });

  it("reads the status again after a subscription failure, so the setup shows what fixes it", async () => {
    const host = fakeAssistantHost({ connection: { subscriptionEnabled: true, provider: "subscription" }, subscription: signedIn() });
    host.nextResult = () => {
      host.subscription = subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in", message: SIGNED_OUT_MESSAGE });
      return { runId: "r1", outcome: "error", error: { code: "not_signed_in", message: SIGNED_OUT_MESSAGE }, usage: usage() };
    };
    const store = createAssistantStore({ persistModel: false });
    const controller = createAssistantController(host, store);
    await controller.refresh();
    await controller.send("a checkout");
    expect(store.getState().status?.subscription?.state).toBe("signed_out");
    expect(store.getState().items.at(-1)).toMatchObject({ kind: "notice", tone: "error", code: "not_signed_in" });

    host.nextResult = () => {
      host.subscription = subscriptionStatus({ state: "not_installed", message: NOT_INSTALLED_MESSAGE });
      return { runId: "r2", outcome: "error", error: { code: "agent_not_installed", message: NOT_INSTALLED_MESSAGE }, usage: usage() };
    };
    await controller.send("again");
    expect(store.getState().status?.subscription?.state).toBe("not_installed");
  });
});
