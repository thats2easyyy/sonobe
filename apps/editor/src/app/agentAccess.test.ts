import { describe, expect, it } from "vitest";
import type { RpcRegistrar } from "../host/types.ts";
import { AGENT_READ_ONLY_CODE, guardRpcRegistrar, isAgentWrite } from "./agentAccess.ts";
import type { AgentPermission } from "./settings.ts";

function fakeRpc() {
  const handlers = new Map<string, (params: unknown) => unknown>();
  const rpc: RpcRegistrar = {
    handle(method, fn) {
      handlers.set(method, fn);
      return () => handlers.delete(method);
    },
    methods: () => [...handlers.keys()],
    fail: (code, message, data) => ({ failed: { code, message, data } }),
  };
  return { rpc, handlers };
}

describe("agent access", () => {
  it("knows which bridge calls write", () => {
    expect(isAgentWrite("document.apply", { ops: [] })).toBe(true);
    expect(isAgentWrite("document.apply", { ops: [], dryRun: true })).toBe(false);
    expect(isAgentWrite("history.undo", {})).toBe(true);
    expect(isAgentWrite("document.info", {})).toBe(false);
    expect(isAgentWrite("sim.step", {})).toBe(false);
    // An MCP client's design preview draws on the canvas and changes nothing.
    expect(isAgentWrite("design.preview", { status: "writing", html: "<p>Hi</p>" })).toBe(false);
  });

  it("lets the app act for the person while Claude is read only: Save in the close prompt, and reopening a draft", () => {
    expect(isAgentWrite("document.save", { interactive: true })).toBe(false);
    expect(isAgentWrite("document.recoverDraft", { id: "draft-0001-abcd", person: true })).toBe(false);
    // The forms an agent's save_document and open_document send are still writes.
    expect(isAgentWrite("document.save", { noDialog: true })).toBe(true);
    expect(isAgentWrite("document.save", { noDialog: true, path: "/Users/me/Deck.sonobe", force: true })).toBe(true);
    expect(isAgentWrite("document.recoverDraft", { id: "draft-0001-abcd" })).toBe(true);
    expect(isAgentWrite("document.save", { interactive: "true" })).toBe(true);
    const { rpc, handlers } = fakeRpc();
    const guarded = guardRpcRegistrar(rpc, () => "readOnly");
    guarded.handle("document.save", () => ({ ok: true }));
    guarded.handle("document.recoverDraft", () => ({ ok: true }));
    expect(handlers.get("document.save")!({ interactive: true })).toEqual({ ok: true });
    expect(handlers.get("document.save")!({ noDialog: true })).toMatchObject({ failed: { code: AGENT_READ_ONLY_CODE } });
    expect(handlers.get("document.recoverDraft")!({ id: "draft-0001-abcd", person: true })).toEqual({ ok: true });
    expect(handlers.get("document.recoverDraft")!({ id: "draft-0001-abcd" })).toMatchObject({ failed: { code: AGENT_READ_ONLY_CODE } });
  });

  it("refuses writes while read only and passes everything else through", () => {
    const { rpc, handlers } = fakeRpc();
    let permission: AgentPermission = "readOnly";
    const guarded = guardRpcRegistrar(rpc, () => permission);
    guarded.handle("document.apply", () => ({ ok: true }));
    guarded.handle("document.info", () => ({ name: "Main" }));
    const apply = handlers.get("document.apply")!;
    expect(apply({ ops: [{ op: "addLayer" }] })).toMatchObject({ failed: { code: AGENT_READ_ONLY_CODE, data: { method: "document.apply" } } });
    expect(apply({ ops: [], dryRun: true })).toEqual({ ok: true });
    expect(handlers.get("document.info")!({})).toEqual({ name: "Main" });
    permission = "edit";
    expect(apply({ ops: [] })).toEqual({ ok: true });
    expect(guarded.methods?.()).toEqual(["document.apply", "document.info"]);
  });
});
