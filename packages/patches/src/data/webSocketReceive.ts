/** WebSocket Receive: the messages a WebSocket Connection received this frame, and the latest one. */

import type { Value } from "@sonobe/core";
import { definePatch, loopOf, warnOnce, zeroValue } from "../infra/index.ts";
import { variantOf } from "./shared.ts";
import { lookupRecord, type WebSocketMessage } from "./webSocketShared.ts";

export interface WebSocketReceiveState {
  /** The variant `message` holds; a type change resets it to the zero value. */
  variant: string | undefined;
  message: Value;
}

function parsed(message: WebSocketMessage): { ok: boolean; value: unknown } {
  if (!message.parsed) {
    try {
      message.parsed = { ok: true, value: JSON.parse(message.text) };
    } catch {
      message.parsed = { ok: false, value: null };
    }
  }
  return message.parsed;
}

export const webSocketReceive = definePatch<WebSocketReceiveState>("webSocketReceive", {
  state: () => ({ variant: undefined, message: null }),
  evaluate(ctx) {
    const s = ctx.state;
    const variant = variantOf(ctx, webSocketReceive);
    if (s.variant !== variant) {
      s.variant = variant;
      s.message = zeroValue(variant);
    }
    const handle = ctx.inputItems("connection")[0];
    const record = lookupRecord(ctx.services, handle);
    if (!record && handle !== null && handle !== undefined && ctx.isConnected("connection")) {
      warnOnce(ctx, "handle", "WebSocket Receive needs a Connection from a WebSocket Connection patch.");
    }
    const batch = record && record.frame === ctx.frame ? record.messages : [];
    const matched: unknown[] = [];
    for (const m of batch) {
      if (variant === "json") {
        const p = parsed(m);
        if (p.ok) matched.push(p.value);
      } else matched.push(m.text);
    }
    if (matched.length > 0) s.message = matched[matched.length - 1] as Value;
    ctx.output("message", s.message);
    ctx.output("messages", loopOf(matched) as never);
    if (matched.length > 0) ctx.pulse("received");
    ctx.requestNextFrame();
  },
});
