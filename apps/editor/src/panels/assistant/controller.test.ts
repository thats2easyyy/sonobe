import { describe, expect, it } from "vitest";
import { createAssistantStore } from "./assistantStore.ts";
import { createAssistantController } from "./controller.ts";
import { fakeAssistantHost, usage } from "./testing.ts";
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
    expect(linked).toEqual({ status: { linked: { name: "placemark", path: "~/code/placemark", persisted: true }, missing: false } });
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("placemark");

    host.nextLink = () => ({ status: host.folder, cancelled: true });
    expect(await controller.linkCodeFolder()).toMatchObject({ cancelled: true });
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("placemark");

    host.nextLink = () => ({ status: host.folder, error: "Pick your app's folder, not your whole home folder." });
    expect(await controller.linkCodeFolder()).toMatchObject({ error: "Pick your app's folder, not your whole home folder." });

    host.folder = { linked: { name: "placemark", path: "~/code/placemark", persisted: true }, missing: true };
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
    expect(await controller.openInClaudeCode("In my open Sonobe prototype “Placemark”, design a new screen")).toEqual({ ok: true, folder: "~/code/placemark" });
    expect(host.handoffs).toEqual(["In my open Sonobe prototype “Placemark”, design a new screen"]);
    expect(store.getState().status?.codeFolder?.linked?.name).toBe("placemark");
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
