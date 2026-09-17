import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SonobeHost } from "@sonobe/mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore, createTestCipher, type SecretStore } from "../secrets.ts";
import { ASSISTANT_IPC, ASSISTANT_KEY_SECRET, type AssistantEvent, type AssistantStatus } from "./protocol.ts";
import { keyHint, registerAssistant, type AssistantIpcEvent, type AssistantIpcMain, type AssistantSender } from "./register.ts";
import { fakeBridge, scriptedClient, type FakeTurn, type ScriptedClient } from "./testing.ts";

interface FakeSender extends AssistantSender {
  sent: { channel: string; payload: unknown }[];
  destroy(): void;
}

function fakeSender(id: number): FakeSender {
  let destroyed = false;
  const listeners: (() => void)[] = [];
  return {
    id,
    sent: [],
    send(channel, payload) {
      this.sent.push({ channel, payload: structuredClone(payload) });
    },
    isDestroyed: () => destroyed,
    once(_event, listener) {
      listeners.push(listener);
    },
    destroy() {
      destroyed = true;
      for (const l of listeners.splice(0)) l();
    },
  };
}

function fakeIpcMain() {
  const handlers = new Map<string, (event: AssistantIpcEvent, ...args: unknown[]) => unknown>();
  const ipcMain: AssistantIpcMain = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      handlers.set(channel, listener);
    },
    removeHandler: (channel) => void handlers.delete(channel),
  };
  const invoke = async <T>(sender: AssistantSender, channel: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return structuredClone((await handler({ sender }, ...args)) as T);
  };
  return { ipcMain, handlers, invoke };
}

let dir: string;
let store: SecretStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-assistant-ipc-"));
  store = createSecretStore({ file: path.join(dir, "secrets.json"), cipher: createTestCipher(), platform: "darwin" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fakeHost = {} as SonobeHost;

function setup(turns: FakeTurn[] = [], options: { trusted?: (event: AssistantIpcEvent) => boolean } = {}) {
  const ipc = fakeIpcMain();
  const api: ScriptedClient = scriptedClient(turns);
  const registration = registerAssistant({
    ipcMain: ipc.ipcMain,
    isTrustedSender: options.trusted ?? (() => true),
    host: () => fakeHost,
    secrets: () => store,
    version: "0.1.0-test",
    createClient: (key) => {
      api.keys.push(key);
      return api.client;
    },
  });
  return { ...ipc, api, registration };
}

describe("registerAssistant", () => {
  it("registers every channel and removes them on dispose", async () => {
    const { handlers, registration } = setup();
    expect([...handlers.keys()].sort()).toEqual(Object.values(ASSISTANT_IPC).filter((c) => c !== ASSISTANT_IPC.event).sort());
    await registration.dispose();
    expect(handlers.size).toBe(0);
  });

  it("reports status with a key hint, never the key", async () => {
    const { invoke } = setup();
    const sender = fakeSender(7);
    let status = await invoke<AssistantStatus>(sender, ASSISTANT_IPC.status);
    expect(status).toMatchObject({ hasKey: false, keyHint: null, secrets: { available: true, backend: "keychain" }, defaultModel: "claude-sonnet-5", running: false, messageCount: 0, limits: { maxTurns: 30, deleteConfirmThreshold: 10 } });
    expect(status.models.map((m) => m.id)).toEqual(["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"]);

    await store.set(ASSISTANT_KEY_SECRET, "sk-ant-api03-abcdefghijklmnop3f9a");
    status = await invoke<AssistantStatus>(sender, ASSISTANT_IPC.status);
    expect(status).toMatchObject({ hasKey: true, keyHint: "sk-ant-…3f9a" });
    expect(JSON.stringify(status)).not.toContain("abcdefghijklmnop");
  });

  it("refuses untrusted senders", async () => {
    const { invoke } = setup([], { trusted: (event) => event.sender.id === 1 });
    await expect(invoke(fakeSender(2), ASSISTANT_IPC.status)).rejects.toThrow("Untrusted sender");
    await expect(invoke(fakeSender(2), ASSISTANT_IPC.send, { text: "hi" })).rejects.toThrow("Untrusted sender");
    await expect(invoke(fakeSender(1), ASSISTANT_IPC.status)).resolves.toMatchObject({ hasKey: false });
  });

  it("asks for a key before any API call", async () => {
    const { invoke, api } = setup([{ content: [{ type: "text", text: "hi" }] }]);
    const result = await invoke<{ outcome: string; error?: { code: string } }>(fakeSender(1), ASSISTANT_IPC.send, { text: "hello" });
    expect(result).toMatchObject({ outcome: "error", error: { code: "no_key" } });
    expect(api.requests).toHaveLength(0);
  });

  it("explains when the document host isn't ready", async () => {
    const ipc = fakeIpcMain();
    registerAssistant({ ipcMain: ipc.ipcMain, isTrustedSender: () => true, host: () => null, secrets: () => store, version: "0.1.0-test", createClient: () => scriptedClient([]).client });
    await store.set(ASSISTANT_KEY_SECRET, "sk-ant-api03-abcdefghijklmnop3f9a");
    expect(await ipc.invoke(fakeSender(1), ASSISTANT_IPC.send, { text: "hello" })).toMatchObject({ outcome: "error", error: { code: "no_document" } });
  });

  it("reads the key from secrets, checks it, and forgets a closed window's chat", async () => {
    const { invoke, api, registration } = setup();
    await store.set(ASSISTANT_KEY_SECRET, "  sk-ant-api03-abcdefghijklmnop3f9a\n");
    const sender = fakeSender(3);
    expect(await invoke(sender, ASSISTANT_IPC.checkKey)).toEqual({ ok: true });
    expect(api.keys).toEqual(["sk-ant-api03-abcdefghijklmnop3f9a"]);
    expect(await invoke(sender, ASSISTANT_IPC.stop)).toBe(false);
    expect(await invoke(sender, ASSISTANT_IPC.confirm, "missing", true)).toBe(false);
    expect(await invoke(sender, ASSISTANT_IPC.reset)).toMatchObject({ hasKey: true, messageCount: 0 });
    sender.destroy();
    expect(registration.agent.snapshot("3").messageCount).toBe(0);
  });

  it("builds the real SDK client with only the person's key", async () => {
    const { createAnthropicClient } = await import("./register.ts");
    const client = createAnthropicClient("sk-ant-api03-abcdefghijklmnop3f9a") as unknown as { apiKey: string | null; authToken: string | null };
    expect(client.apiKey).toBe("sk-ant-api03-abcdefghijklmnop3f9a");
    expect(client.authToken).toBeNull();
  });
});

describe("keyHint", () => {
  it("shows at most the last four characters", () => {
    expect(keyHint("sk-ant-api03-1234567890abcd")).toBe("sk-ant-…abcd");
    expect(keyHint("custom-key-value-9876")).toBe("…9876");
    expect(keyHint("short")).toBe("…");
  });
});

describe("streaming to the window", () => {
  it("runs a reply and sends its events to the requesting window only, one chat per window", async () => {
    const ipc = fakeIpcMain();
    const api = scriptedClient([
      { content: [{ type: "tool_use", id: "t1", name: "get_outline", input: {} }] },
      { content: [{ type: "text", text: "Hello from the Assistant" }] },
      { content: [{ type: "text", text: "Other window" }] },
    ]);
    const bridge = fakeBridge(() => ({ content: [{ type: "text", text: "component main" }] }));
    const hosts: SonobeHost[] = [];
    registerAssistant({
      ipcMain: ipc.ipcMain,
      isTrustedSender: () => true,
      host: () => fakeHost,
      secrets: () => store,
      version: "0.1.0-test",
      createClient: () => api.client,
      createToolBridge: (host) => {
        hosts.push(host);
        return bridge;
      },
    });
    await store.set(ASSISTANT_KEY_SECRET, "sk-ant-api03-abcdefghijklmnop3f9a");
    const sender = fakeSender(9);
    const other = fakeSender(10);

    const result = await ipc.invoke<{ outcome: string }>(sender, ASSISTANT_IPC.send, { text: "hi", model: "claude-haiku-4-5-20251001" });
    expect(result.outcome).toBe("completed");
    const types = sender.sent.map((s) => (s.payload as AssistantEvent).type);
    expect(types[0]).toBe("run_started");
    expect(types).toContain("tool_started");
    expect(types.at(-1)).toBe("run_finished");
    expect(sender.sent.every((s) => s.channel === ASSISTANT_IPC.event)).toBe(true);
    expect(other.sent).toEqual([]);
    expect(api.requests[0]!.model).toBe("claude-haiku-4-5-20251001");
    expect(hosts).toEqual([fakeHost]);
    expect(await ipc.invoke<AssistantStatus>(sender, ASSISTANT_IPC.status)).toMatchObject({ messageCount: 2, usage: { requests: 2 } });

    await ipc.invoke(other, ASSISTANT_IPC.send, { text: "hello" });
    expect(api.requests[2]!.messages).toHaveLength(1);
    expect(await ipc.invoke<AssistantStatus>(other, ASSISTANT_IPC.status)).toMatchObject({ messageCount: 2 });
    expect(await ipc.invoke<AssistantStatus>(sender, ASSISTANT_IPC.status)).toMatchObject({ messageCount: 2 });

    // A destroyed window's chat goes away and events stop.
    sender.destroy();
    expect(await ipc.invoke<AssistantStatus>(sender, ASSISTANT_IPC.status)).toMatchObject({ messageCount: 0 });
  });
});
