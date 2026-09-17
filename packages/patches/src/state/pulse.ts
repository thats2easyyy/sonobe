/** Pulse: fires Turned On and Turned Off when a watched state changes. A first evaluation only records. */

import { createEdgeState, definePatch, detectEdges, toBool } from "../infra/index.ts";
import type { EdgeState } from "../infra/index.ts";

export const pulsePatch = definePatch<EdgeState>("pulse", {
  state: createEdgeState,
  evaluate(ctx) {
    const { rose, fell } = detectEdges(ctx.state, toBool(ctx.input("on")));
    if (rose) ctx.pulse("turnedOn");
    if (fell) ctx.pulse("turnedOff");
  },
});
