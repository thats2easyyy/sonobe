/**
 * Port address strings (ARCHITECTURE §3.2):
 *   "patchId.portKey"   patch port
 *   "@layerId.propKey"  layer property (or layer output when used as a source)
 *   "$in.key"           component published input (source side)
 *   "$out.key"          component published output (target side)
 * Ids may be batch refs ("$tap.tap", "@$card.scale"). An optional "#n" suffix names a loop index.
 */

import type { Id, PortAddress } from "./types.ts";

export type ParsedAddress =
  | { kind: "patch"; id: Id; key: string; index?: number }
  | { kind: "layer"; id: Id; key: string; index?: number }
  | { kind: "componentInput"; key: string; index?: number }
  | { kind: "componentOutput"; key: string; index?: number };

const ADDRESS = /^(@)?(\$?[A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:#(\d+))?$/;

/** Parse an address; undefined when malformed. */
export function parseAddress(address: string): ParsedAddress | undefined {
  if (typeof address !== "string") return undefined;
  const m = ADDRESS.exec(address.trim());
  if (!m) return undefined;
  const [, at, id, key, idx] = m as unknown as [string, string | undefined, string, string, string | undefined];
  const index = idx === undefined ? undefined : Number(idx);
  const withIndex = <T extends object>(a: T) => (index === undefined ? a : { ...a, index });
  if (at) return id === "$in" || id === "$out" ? undefined : withIndex({ kind: "layer" as const, id, key });
  if (id === "$in") return withIndex({ kind: "componentInput" as const, key });
  if (id === "$out") return withIndex({ kind: "componentOutput" as const, key });
  return withIndex({ kind: "patch" as const, id, key });
}

/** Format a parsed address back into its string form. */
export function formatAddress(address: ParsedAddress): PortAddress {
  const suffix = address.index === undefined ? "" : `#${address.index}`;
  switch (address.kind) {
    case "patch":
      return `${address.id}.${address.key}${suffix}`;
    case "layer":
      return `@${address.id}.${address.key}${suffix}`;
    case "componentInput":
      return `$in.${address.key}${suffix}`;
    case "componentOutput":
      return `$out.${address.key}${suffix}`;
  }
}

export const patchAddress = (patchId: Id, key: string): PortAddress => `${patchId}.${key}`;
export const layerAddress = (layerId: Id, key: string): PortAddress => `@${layerId}.${key}`;
export const componentInputAddress = (key: string): PortAddress => `$in.${key}`;
export const componentOutputAddress = (key: string): PortAddress => `$out.${key}`;

/** The item id an address points at (patch or layer), if any. */
export function addressItemId(address: ParsedAddress): Id | undefined {
  return address.kind === "patch" || address.kind === "layer" ? address.id : undefined;
}
