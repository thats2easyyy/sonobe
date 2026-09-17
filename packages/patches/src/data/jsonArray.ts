/** JSON Array: collects its item ports into one JSON array. */

import type { PatchNode, PortSpec } from "@sonobe/core";
import { definePatch, nodePorts, resolvePortDefault, variadicKeys } from "../infra/index.ts";
import { portJson, variantOf, withMutedBehavior } from "./shared.ts";

/**
 * Item ports counted from 0 (`item0…`). Declared as dynamic ports so runtimes whose port
 * resolution still expands variadic ports from 1 also see `item0`.
 */
function itemPorts(node: PatchNode): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const inputs = nodePorts(jsonArray, node.typeParam, node.inputCount)
    .inputs.filter((p) => p.variadicIndex !== undefined)
    .map((p): PortSpec => {
      const port: PortSpec = { key: p.key, name: p.name, type: p.type, description: p.description };
      const fallback = resolvePortDefault(jsonArray, p.key, node.typeParam);
      if (fallback !== undefined) port.default = fallback;
      return port;
    });
  return { inputs, outputs: [] };
}

export const jsonArray = withMutedBehavior(
  definePatch("jsonArray", {
    dynamicPorts: (node) => itemPorts(node),
    evaluate(ctx) {
      if (ctx.node.muted) {
        ctx.output("array", []);
        return;
      }
      const variant = variantOf(ctx, jsonArray);
      const array: unknown[] = [];
      for (const key of variadicKeys(jsonArray, Math.max(1, ctx.inputCount))) array.push(portJson(ctx, ctx.input(key), variant));
      ctx.output("array", array);
    },
  }),
  "evaluate",
);
