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
