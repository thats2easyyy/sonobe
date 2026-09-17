/** WebSocket Send: sends text or compact JSON over a WebSocket Connection on a pulse. */

import { definePatch, toText } from "../infra/index.ts";
import { variantOf, warnIndexed } from "./shared.ts";
import { lookupRecord } from "./webSocketShared.ts";

/** Sends are refused while more than this many bytes wait to go out. */
export const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

export const webSocketSend = definePatch("webSocketSend", {
  evaluate(ctx) {
    if (!ctx.pulsed("send")) return;
    const record = lookupRecord(ctx.services, ctx.input("connection"));
    if (!record) {
      warnIndexed(ctx, "handle", "WebSocket Send needs a Connection from a WebSocket Connection patch.");
      return;
    }
    const socket = record.socket;
    if (record.phase !== "open" || !socket) {
      record.sendError = "Couldn't send: the WebSocket isn't connected yet.";
      return;
    }
    try {
      const message = ctx.input("message");
      const text = variantOf(ctx, webSocketSend) === "json" ? (JSON.stringify(message ?? null) ?? "null") : toText(message);
      if ((socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        record.sendError = "Couldn't send: messages are going out faster than the connection can carry them.";
        return;
      }
      socket.send(text);
      record.sendOk = true;
      ctx.pulse("sent");
    } catch (e) {
      record.sendError = `Couldn't send: ${String(e)}`;
    }
  },
});
