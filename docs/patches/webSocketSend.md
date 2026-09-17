<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# WebSocket Send

Sends a text or JSON message over a WebSocket connection when it gets a pulse.

| | |
|---|---|
| Type key | `webSocketSend` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | send message, socket send, ws send, emit, publish, broadcast event, realtime send |

## How it works
WebSocket Send sends a message to a server when **Send** gets a pulse (a signal that's on for one frame). It works together with a WebSocket Connection patch.

- **Connection** comes from a WebSocket Connection patch.
- **Message** is what gets sent. Right-click to choose Text or JSON; JSON is sent as text the server can parse.
- **Sent** pulses when the message went out.

If the connection isn't open, nothing is sent, and the problem appears on the connection's Error Message.

## Tips
- Use several Send patches on one connection, such as a Text one for pings and a JSON one for events.
- If Message is a loop, each item goes out as its own message. Use Loop to Array to send them as one list.
- To stream a changing value, like a dragged position, wire Pulse on Change into Send.

## Coming from Origami
Sent is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Connection**<br>`connection` | `any` | none | The Connection output of a WebSocket Connection patch. |
| **Send**<br>`send` | `pulse` | — | Pulse to send the current Message. |
| **Message**<br>`message` | `variant` | `""` | The text or JSON to send. A loop sends each item as its own message. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Sent**<br>`sent` | `pulse` | Pulses when a message was handed to the connection. It doesn't fire when the connection isn't open. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `text` (default), `json`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `json` | `message` | `{}` |

## Examples

### Send a like when a button is tapped

```text
layer like_button rectangle "Like Button" @16,760 358x56
patch live webSocketConnection connect=true url="wss://example.com/events"
patch tap_like interaction layer=@like_button
patch send_like webSocketSend<json> connection←live.connection send←tap_like.tap message={"type":"like","postId":42}
```

### Say hello as soon as the connection opens

```text
patch live webSocketConnection connect=true url="wss://example.com/chat"
patch opened pulse on←live.connected
patch hello webSocketSend<text> connection←live.connection send←opened.turnedOn message=hello
```

## Common mistakes

- The connection's Error Message says it isn't connected yet: Send pulsed before the connection opened, often on the first frame. Wire Connected through a Pulse patch's Turned On to send once the line is open.
- Editing Message doesn't send anything: messages only go out on a pulse. Wire a Tap or Pulse on Change into Send.
- The server gets several messages instead of one list: Message is a loop, so each item is sent separately. Convert it with Loop to Array first.

## Pairs well with

- [WebSocket Connection](webSocketConnection.md): Keeps a live two-way connection to a WebSocket server open while Connect is on, for sending and receiving messages instantly.
- [WebSocket Receive](webSocketReceive.md): Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pulse on Change](pulseOnChange.md): Sends a pulse whenever a watched value changes, such as a new page number or a different tab.
- [Loop to Array](loopToArray.md): Packs a whole loop into one JSON array you can send, store, or inspect.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** WebSocket Send (`builtin.websocket.send`)
- **Also imports:** `builtin.webSocket.send`
