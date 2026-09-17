/**
 * Variable Broadcaster: computes nothing at runtime. The engine's graph compiler resolves every
 * receiver statically by name, scope, and type, and binds it to this patch's `value` driver as an
 * implicit edge (engine README, Variables).
 */

import { definePatch } from "../infra/index.ts";

export const variableBroadcaster = definePatch("variableBroadcaster", {
  evaluate() {
    // No-op: receivers read `value` through compiled implicit edges.
  },
});
