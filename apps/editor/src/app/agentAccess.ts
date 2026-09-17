/**
 * Agent permissions for the MCP bridge. In "read only", Claude can read the outline, simulate, and
 * take screenshots, but every call that would change or replace the document fails with a
 * teaching error. The guard wraps the RPC registrar the bridge handlers register through, so it
 * applies to handlers registered later too.
 */

import type { RpcRegistrar } from "../host/types.ts";
import type { AgentPermission } from "./settings.ts";

/** Bridge methods that change the document, what's on disk, or which document is open. */
export const AGENT_WRITE_METHODS: ReadonlySet<string> = new Set(["document.apply", "document.save", "document.open", "document.new", "history.undo"]);

export const AGENT_READ_ONLY_CODE = "agent_read_only";

/** True when a call would change something (a dry-run apply only previews). */
export function isAgentWrite(method: string, params: unknown): boolean {
  if (!AGENT_WRITE_METHODS.has(method)) return false;
  if (method === "document.apply" && params && typeof params === "object" && (params as { dryRun?: unknown }).dryRun === true) return false;
  return true;
}

export const READ_ONLY_MESSAGE = "Sonobe is set so Claude can only read this prototype. To let Claude make changes, open Settings in Sonobe and choose “Can edit” under Claude.";

/** A registrar whose handlers refuse writes while `permission()` is "readOnly". */
export function guardRpcRegistrar(rpc: RpcRegistrar, permission: () => AgentPermission): RpcRegistrar {
  const guarded: RpcRegistrar = {
    handle(method, fn) {
      return rpc.handle(method, (params) => (permission() === "readOnly" && isAgentWrite(method, params) ? rpc.fail(AGENT_READ_ONLY_CODE, READ_ONLY_MESSAGE, { method, setting: "agentPermission" }) : fn(params)));
    },
    fail: (code, message, data) => rpc.fail(code, message, data),
  };
  if (rpc.methods) guarded.methods = () => rpc.methods!();
  return guarded;
}
