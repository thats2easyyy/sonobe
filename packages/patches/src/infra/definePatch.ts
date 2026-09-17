/** definePatch: attach an evaluator to a catalog spec. */

import { didYouMean, didYouMeanText } from "@sonobe/core";
import type { PatchSpec } from "@sonobe/core";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimeServices } from "@sonobe/engine";
import { SPECS, getSpec } from "../specs.ts";

/** The runtime half of a patch; everything else comes from its catalog spec. */
export interface PatchImplementation<S = undefined> {
  /** Per-instance state, created once per patch × loop index. */
  state?: () => S;
  evaluate: (ctx: PatchContext<S>) => void;
  /** Release sockets, audio, and timers on restart or removal. */
  dispose?: (state: S, services: RuntimeServices) => void;
  /** Node-dependent ports (the catalog's `dynamicPortsRule`). */
  dynamicPorts?: PatchSpec["dynamicPorts"];
  /**
   * What the runtime does while the patch is muted: "bypass" (default) passes inputs through,
   * "zero" outputs zero values, and "evaluate" runs `evaluate`, which checks `ctx.muted` itself.
   */
  mutedBehavior?: MutedBehavior;
}

/**
 * Merge an implementation into the catalog spec for `type`. Throws when `type` isn't a catalog
 * patch type or `evaluate` isn't a function.
 */
export function definePatch<S = undefined>(type: string, implementation: PatchImplementation<S>): PatchDefinition<S> {
  const spec = getSpec(type);
  if (!spec) {
    const candidates = Object.values(SPECS).map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }));
    throw new Error(`definePatch: "${type}" isn't a catalog patch type.${didYouMeanText(didYouMean(type, candidates))} Add it to packages/patches/catalog first.`);
  }
  if (typeof implementation?.evaluate !== "function") throw new Error(`definePatch("${type}"): evaluate must be a function.`);
  const definition: PatchDefinition<S> = { ...spec, evaluate: implementation.evaluate };
  if (implementation.state) definition.state = implementation.state;
  if (implementation.dispose) definition.dispose = implementation.dispose;
  if (implementation.dynamicPorts) definition.dynamicPorts = implementation.dynamicPorts;
  if (implementation.mutedBehavior !== undefined) {
    const behavior = implementation.mutedBehavior;
    if (behavior !== "bypass" && behavior !== "zero" && behavior !== "evaluate") {
      throw new Error(`definePatch("${type}"): mutedBehavior must be "bypass", "zero", or "evaluate".`);
    }
    definition.mutedBehavior = behavior;
  }
  return definition;
}
