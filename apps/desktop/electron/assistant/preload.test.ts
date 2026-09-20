import { describe, expect, it } from "vitest";
import { attachAssistantBridge, createAssistantApi, type AssistantIpcRenderer } from "./preload.ts";
import { ASSISTANT_IPC, type AssistantEvent } from "./protocol.ts";

function fakeIpcRenderer(reply: (channel: string, args: unknown[]) => unknown = () => null) {
  const invocations: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  const ipc: AssistantIpcRenderer = {
    invoke: async (channel, ...args) => {
      invocations.push({ channel, args });
      return reply(channel, args);
    },
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
  };
  const emit = (channel: string, payload: unknown) => {
    for (const l of listeners.get(channel) ?? []) l({}, payload);
  };
  return { ipc, invocations, listeners, emit };
}

describe("assistant preload bridge", () => {
  it("invokes the assistant channels with sanitized arguments", async () => {
    const { ipc, invocations } = fakeIpcRenderer((channel) => (channel === ASSISTANT_IPC.stop ? true : { ok: true }));
    const api = createAssistantApi(ipc);
    await api.status();
    await api.send({ text: "Make the card bounce", model: "claude-opus-5" });
    await api.send({ text: 42 as unknown as string, model: 7 as unknown as string });
    expect(await api.stop()).toBe(true);
    await api.reset();
    await api.confirm("c1", "yes" as unknown as boolean);
    await api.checkKey();
    expect(invocations).toEqual([
      { channel: ASSISTANT_IPC.status, args: [] },
      { channel: ASSISTANT_IPC.send, args: [{ text: "Make the card bounce", model: "claude-opus-5" }] },
      { channel: ASSISTANT_IPC.send, args: [{ text: "42" }] },
      { channel: ASSISTANT_IPC.stop, args: [] },
      { channel: ASSISTANT_IPC.reset, args: [] },
      { channel: ASSISTANT_IPC.confirm, args: ["c1", false] },
      { channel: ASSISTANT_IPC.checkKey, args: [] },
    ]);
  });

  it("passes the canvas context and the code folder calls through, and strips extras", async () => {
    const { ipc, invocations } = fakeIpcRenderer();
    const api = createAssistantApi(ipc);
    const context = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [], anything: "main sanitizes it" };
    await api.send({ text: "a profile screen", context, extra: "dropped" } as unknown as Parameters<typeof api.send>[0]);
    for (const junk of ["main", ["main"], null, 7]) await api.send({ text: "hi", context: junk } as unknown as Parameters<typeof api.send>[0]);
    await api.codeFolder();
    await api.linkCodeFolder();
    await api.unlinkCodeFolder();
    expect(invocations).toEqual([
      { channel: ASSISTANT_IPC.send, args: [{ text: "a profile screen", context }] },
      ...Array.from({ length: 4 }, () => ({ channel: ASSISTANT_IPC.send, args: [{ text: "hi" }] })),
      { channel: ASSISTANT_IPC.codeFolder, args: [] },
      { channel: ASSISTANT_IPC.linkCodeFolder, args: [] },
      { channel: ASSISTANT_IPC.unlinkCodeFolder, args: [] },
    ]);
  });

  it("strips Electron's remote-method prefix from errors", async () => {
    const ipc: AssistantIpcRenderer = {
      invoke: () => Promise.reject(new Error("Error invoking remote method 'sonobe:assistant:status': Error: Untrusted sender")),
      on: () => undefined,
      removeListener: () => undefined,
    };
    await expect(createAssistantApi(ipc).status()).rejects.toThrow(/^Untrusted sender$/);
  });

  it("delivers events until unsubscribed, ignoring junk payloads", () => {
    const { ipc, emit, listeners } = fakeIpcRenderer();
    const api = createAssistantApi(ipc);
    const seen: AssistantEvent[] = [];
    const off = api.onEvent((e) => seen.push(e));
    emit(ASSISTANT_IPC.event, { type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    emit(ASSISTANT_IPC.event, "not an event");
    emit(ASSISTANT_IPC.event, null);
    off();
    emit(ASSISTANT_IPC.event, { type: "run_finished", runId: "r1", outcome: "completed", usage: {} });
    expect(seen).toEqual([{ type: "run_started", runId: "r1", model: "claude-sonnet-5" }]);
    expect(listeners.get(ASSISTANT_IPC.event)?.size).toBe(0);
  });

  it("attaches `assistant` to the host object before it's exposed", () => {
    const host: Record<string, unknown> = { platform: "darwin" };
    attachAssistantBridge(host, fakeIpcRenderer().ipc);
    expect(Object.keys(host)).toEqual(["platform", "assistant"]);
    expect(Object.keys(host.assistant as object).sort()).toEqual(["checkKey", "codeFolder", "confirm", "linkCodeFolder", "onEvent", "reset", "send", "status", "stop", "unlinkCodeFolder"]);
  });
});
