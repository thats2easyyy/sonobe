<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# WebSocket Receive

Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives.

| | |
|---|---|
| Type key | `webSocketReceive` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | receive message, socket listen, ws receive, on message, subscribe, incoming message, realtime receive |

## How it works
WebSocket Receive listens on a WebSocket connection and outputs the messages the server sends. It works together with a WebSocket Connection patch.

- **Connection** comes from a WebSocket Connection patch.
- Right-click to choose **Text** or **JSON**. A JSON receiver ignores messages that aren't valid JSON, and a Text receiver gets everything as text.
- **Message** holds the latest message until the next one arrives.
- **Messages** lists every message that arrived this frame, which matters when a server sends several at once.
- **Received** pulses (a signal that's on for one frame) whenever a new message arrives, even when it repeats the last one.

You can use as many Receive patches on one connection as you like, and each one sees every message.

## Tips
- Bind Message to a layer for values that replace each other, like a live score or a cursor position.
- For chat feeds and other lists, add from Messages when Received pulses so bursts don't lose items.
- Pass a JSON Message through Value for Key to read one field.

## Coming from Origami
Message is always a single value. Several messages in one frame come out on the new **Messages** output, and **Received** is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Connection**<br>`connection` | `connection` | none | The Connection output of a WebSocket Connection patch. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Message**<br>`message` | `variant` | The latest message that matches this patch's type, held until the next one arrives. |
| **Messages**<br>`messages` | `variant` · whole loop | Every matching message that arrived this frame, in order, as a loop; empty on frames with no messages. |
| **Received**<br>`received` | `pulse` | Pulses on each frame where at least one matching message arrived, even if it repeats the previous one. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `text` (default), `json`.

## Examples

### Count incoming messages

```text
layer message_count text "Message Count" @24,120 text←tally.count
patch live webSocketConnection connect=true url="wss://example.com/live"
patch inbox webSocketReceive<json> connection←live.connection
patch tally counter increase←inbox.received
```

### Show a status line pushed by a server

```text
layer status_banner text "Status Banner" @24,80 text←status.message
patch live webSocketConnection connect=true url="wss://example.com/status"
patch status webSocketReceive<text> connection←live.connection
```

## Common mistakes

- A chat list skips messages: two arrived in the same frame and Message only holds the latest. Add items from Messages when Received pulses.
- A JSON receiver never updates: the server sends plain text that isn't valid JSON. Switch the patch to Text to see what arrives.
- Repeated identical messages don't trigger anything: Pulse on Change only fires when the value differs. Use Received, which pulses for every message.

## Pairs well with

- [WebSocket Connection](webSocketConnection.md): Keeps a live two-way connection to a WebSocket server open while Connect is on, for sending and receiving messages instantly.
- [WebSocket Send](webSocketSend.md): Sends a text or JSON message over a WebSocket connection when it gets a pulse.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** WebSocket Receive (`builtin.websocket.receive`)
- **Also imports:** `builtin.webSocket.receive`
