/**
 * Component: an instance of a patch component. The engine compiles instances by inlining the
 * component's patches into the host graph (scopes, copies, published ports, muting, inert
 * instances), so there's nothing to evaluate at the patch level. This definition supplies the
 * interface-derived ports and, for hosts that evaluate the node directly instead of inlining it,
 * zero outputs plus one explanation.
 */

import { componentInterfacePorts } from "@sonobe/core";
import type { PatchNode, ResolvedPort } from "@sonobe/core";
import { definePatch, warnOnce, zeroValue } from "../infra/index.ts";

/** Published outputs per node, recorded when ports resolve (PatchContext has no document). */
const publishedOutputs = new WeakMap<PatchNode, ResolvedPort[]>();

/** The warning a host that doesn't inline components logs once. */
export function notInlinedMessage(id: string): string {
  return `Component patch "${id}" needs a runtime that inlines components, like the Sonobe engine. This one evaluated it directly, so its outputs stay at their zero values.`;
}

export const component = definePatch("component", {
  dynamicPorts(node, doc) {
    const ports = componentInterfacePorts(doc, node.component);
    publishedOutputs.set(node, ports.outputs);
    return ports;
  },

  evaluate(ctx) {
    warnOnce(ctx, "not_inlined", notInlinedMessage(ctx.id));
    for (const port of publishedOutputs.get(ctx.node) ?? []) {
      if (port.type !== "pulse") ctx.output(port.key, zeroValue(port.type, port.enumOptions));
    }
  },
});
