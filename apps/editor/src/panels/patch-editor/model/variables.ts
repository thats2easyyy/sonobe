/**
 * New variable patches: a Variable Broadcaster gets a name nobody here uses yet ("Variable",
 * "Variable 2", or the output it's inserted from), and a Variable Receiver takes the only variable
 * it can read. Pure; the patch editor passes the result to insertPatch.
 */

import { parseAddress, reachableVariables, resolveNodePorts, VARIABLE_BROADCASTER_TYPE, VARIABLE_RECEIVER_TYPE, variableSettings, type Id, type PatchNode, type Registry, type SonobeDocument } from "@sonobe/core";

/** `base`, or "base 2", "base 3"… whichever no broadcaster in the component uses. */
export function uniqueVariableName(doc: SonobeDocument, componentId: Id, base = "Variable"): string {
  const used = new Set(
    Object.values(doc.components[componentId]?.patches ?? {})
      .filter((p) => p.type === VARIABLE_BROADCASTER_TYPE)
      .map((p) => variableSettings(p).name),
  );
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** The display name of a patch output ("Progress"), or undefined for other addresses. */
function outputName(doc: SonobeDocument, componentId: Id, registry: Registry, address: string): string | undefined {
  const a = parseAddress(address);
  const node = a?.kind === "patch" ? doc.components[componentId]?.patches[a.id] : undefined;
  if (!a || !node) return undefined;
  return resolveNodePorts(doc, node, registry)?.outputs.find((p) => p.key === a.key)?.name;
}

export interface NewVariablePatch {
  settings?: PatchNode["settings"];
  typeParam?: string;
}

/**
 * Settings for a new patch of `type` in the last component of `componentPath`. Other patch types
 * get nothing. `from`: the output a broadcaster is inserted from (its name names the variable).
 */
export function newVariablePatch(doc: SonobeDocument, registry: Registry, componentPath: readonly Id[], type: string, from?: string): NewVariablePatch {
  const componentId = componentPath.at(-1);
  if (componentId === undefined) return {};
  if (type === VARIABLE_BROADCASTER_TYPE) {
    const base = from !== undefined ? outputName(doc, componentId, registry, from) : undefined;
    return { settings: { name: uniqueVariableName(doc, componentId, base?.trim() || "Variable") } };
  }
  if (type !== VARIABLE_RECEIVER_TYPE) return {};
  const choices = reachableVariables(doc, registry, componentPath);
  if (choices.length !== 1) return {};
  const only = choices[0]!;
  const broadcaster = doc.components[only.componentId]?.patches[only.id];
  return { settings: { name: only.name, ...(only.scope === "global" ? { scope: "global" } : {}) }, ...(broadcaster?.typeParam ? { typeParam: broadcaster.typeParam } : {}) };
}
