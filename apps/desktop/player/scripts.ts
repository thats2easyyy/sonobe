/**
 * Scripts wait for trust on the phone too. The editor runs a project's JavaScript patches only once
 * the person trusts the project (apps/editor/src/runtime/scriptTrust.ts). Sonobe marks each document
 * it sends with `scriptsPaused` while they wait, and this gate keeps the player's javascript patch
 * from running meanwhile. It matters more now that the player has the network: scripts fetch through
 * the platform's `fetch`.
 */

import type { Id } from "@sonobe/core";
import type { EngineRegistry, PatchDefinition } from "@sonobe/engine";

const SCRIPT_PATCH_TYPE = "javascript";

/** A registry whose JavaScript patch evaluates only while `paused()` is false; otherwise it raises one "script_untrusted" warning. */
export function withPausableScripts<R extends EngineRegistry>(registry: R, paused: () => boolean): R {
  const original = registry.definitions.get(SCRIPT_PATCH_TYPE);
  if (!original) return registry;
  const gated: PatchDefinition = {
    ...original,
    evaluate(ctx) {
      if (!paused()) {
        original.evaluate.call(original, ctx);
        return;
      }
      const message = `Scripts in this project are paused. Trust the project in Sonobe on your computer to run "${ctx.node.name ?? (ctx.id as Id)}".`;
      const issue = (ctx.services as Partial<Pick<typeof ctx.services, "issue">>).issue;
      if (typeof issue === "function") issue.call(ctx.services, "script_untrusted", "warning", message);
      else ctx.warnOnce?.("script_untrusted", message);
    },
  };
  const definitions = new Map(registry.definitions);
  definitions.set(SCRIPT_PATCH_TYPE, gated);
  const copy = Object.create(Object.getPrototypeOf(registry) as object) as R;
  Object.assign(copy, registry, { definitions });
  return copy;
}
