/**
 * Connection rules for the patch editor: orient a drop between two handles into output → input,
 * a fast type check while dragging, and a full check (a dry-run connect op) that explains why a
 * link can't be made and offers converter patches to insert.
 */

import { applyOps, canConnect, resolveSource, resolveTarget, type ConnectCheck, type Id, type Op, type Registry, type SonobeDocument, type Suggestion, type ValueType } from "@sonobe/core";
import { flowNodeKind, parseHandleId, portAddress, portKey, type GraphModel, type PortModel, type PortSide } from "./types.ts";

export interface HandleRef {
  nodeId: string;
  handleId: string | null | undefined;
}

export interface OrientedConnection {
  /** Output address. */
  from: string;
  /** Input address. */
  to: string;
  fromNode: string;
  toNode: string;
  fromHandle: string;
  toHandle: string;
}

/** Turn two handles into output → input, whichever order they were dragged in. */
export function orientConnection(a: HandleRef, b: HandleRef): OrientedConnection | undefined {
  const pa = parseHandleId(a.handleId);
  const pb = parseHandleId(b.handleId);
  if (!pa || !pb || pa.side === pb.side) return undefined;
  const [out, outKey, inp, inKey] = pa.side === "out" ? [a, pa.key, b, pb.key] : [b, pb.key, a, pa.key];
  return {
    from: portAddress(out.nodeId, outKey),
    to: portAddress(inp.nodeId, inKey),
    fromNode: out.nodeId,
    toNode: inp.nodeId,
    fromHandle: out.handleId!,
    toHandle: inp.handleId!,
  };
}

/** The port model behind a handle in a derived graph. */
export function portAtHandle(model: GraphModel, ref: HandleRef): PortModel | undefined {
  const parsed = parseHandleId(ref.handleId);
  return parsed ? model.ports.get(portKey(parsed.side, portAddress(ref.nodeId, parsed.key))) : undefined;
}

/** Fast check used while a cable is being dragged (types and direction only). */
export function quickConnectCheck(model: GraphModel, a: HandleRef, b: HandleRef): ConnectCheck & { connection?: OrientedConnection } {
  const connection = orientConnection(a, b);
  if (!connection) return { ok: false, reason: "Connect an output to an input." };
  if (connection.fromNode === connection.toNode && flowNodeKind(connection.fromNode) === "patch") {
    return { ok: false, reason: "A patch can't feed its own input directly. Put a Delay 1 patch between them.", connection };
  }
  const from = model.ports.get(portKey("out", connection.from));
  const to = model.ports.get(portKey("in", connection.to));
  if (!from || !to) return { ok: false, reason: "That port doesn't exist.", connection };
  return { ...canConnect(from.type, to.type), connection };
}

export interface ConnectionCheck {
  ok: boolean;
  from: string;
  to: string;
  /** Implicit conversion on the wire, when there is one. */
  conversion?: string;
  code?: string;
  reason?: string;
  hint?: string;
  /** Converter patches to insert, ready to apply. */
  suggestions: Suggestion[];
}

/** The value type of an address in a component: an output ("out") or an input or property ("in"). */
export function portTypeAt(doc: SonobeDocument, componentId: Id, registry: Registry, address: string, side: PortSide): ValueType | undefined {
  const component = doc.components[componentId];
  if (!component) return undefined;
  const options = { registry, lenient: true };
  const r = side === "out" ? resolveSource(doc, component, address, options) : resolveTarget(doc, component, address, options);
  return r.ok ? r.value.port?.type : undefined;
}

/** Full check through a dry run of the connect op (self edges, unbindable props, type mismatches with converters). */
export function checkConnection(doc: SonobeDocument, componentId: Id, registry: Registry, from: string, to: string): ConnectionCheck {
  const result = applyOps(doc, [{ op: "connect", component: componentId, from, to }], { registry, dryRun: true });
  if (result.ok) {
    const fromType = portTypeAt(doc, componentId, registry, from, "out");
    const toType = portTypeAt(doc, componentId, registry, to, "in");
    const check = fromType && toType ? canConnect(fromType, toType) : { ok: true };
    return check.conversion ? { ok: true, from, to, conversion: check.conversion, suggestions: [] } : { ok: true, from, to, suggestions: [] };
  }
  const error = result.errors.find((e) => e.code !== "skipped") ?? result.errors[0];
  const out: ConnectionCheck = { ok: false, from, to, reason: error?.message ?? "That connection isn't possible.", suggestions: error?.suggestions ?? [] };
  if (error?.code) out.code = error.code;
  if (error?.hint) out.hint = error.hint;
  return out;
}

/** A suggestion's ops with its new patches placed at `position` (side by side). */
export function placeSuggestion(suggestion: Suggestion, componentId: Id, position: { x: number; y: number }): Op[] {
  let n = 0;
  return (suggestion.ops ?? []).map((op): Op => {
    if (op.op !== "addPatch") return op;
    const ui = { x: Math.round(position.x + n * 220), y: Math.round(position.y) };
    n++;
    return { ...op, component: op.component ?? componentId, patch: { ...op.patch, ui: op.patch.ui ?? ui } };
  });
}
