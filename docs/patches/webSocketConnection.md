<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# WebSocket Connection

Keeps a live two-way connection to a WebSocket server open while Connect is on, for sending and receiving messages instantly.

| | |
|---|---|
| Type key | `webSocketConnection` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | websocket, socket, ws, realtime, live connection, multiplayer, server connection, live data |

## How it works
WebSocket Connection keeps a live, two-way line open to a server, so a prototype can send and receive messages instantly. Use it for chat, live cursors, multiplayer games, or a script that controls the prototype remotely.

- **Connect** opens the connection while it's on and closes it when it turns off.
- **URL** is the server address, starting with `wss://` (or `ws://` for a server on your own computer).
- **Connection** is the handle you wire into WebSocket Send and WebSocket Receive. One connection can feed as many of each as you like.
- **Connected** is true while the line is open. **Connecting** is true while it's being set up.
- **Error** and **Error Message** report the latest problem, including failed sends.

The connection doesn't retry by itself. Turn Connect off and on again to reconnect.

## Tips
- Drive Connect from a Switch so a button can start and stop the connection.
- Show Connected on a status dot so you can tell when messages will get through.
- **Headers** (advanced) don't reach the server yet, in the desktop app or the web player, because browsers don't let pages set them. Only Sec-WebSocket-Protocol gets through, so put tokens in the URL instead.

## Coming from Origami
Origami's text Error output is **Error Message** here. Error (a true/false value) and Connecting are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Connect**<br>`connect` | `boolean` · whole loop | `false` | When on, opens the connection and keeps it open; turning it off closes it. Turn it off and on again to reconnect. |
| **URL**<br>`url` | `text` (url) · whole loop | `""` | The server address, starting with wss:// (secure) or ws://. Changing it while connected reconnects to the new address. |
| **Headers**<br>`headers` | `json` · whole loop · advanced | `{}` | A JSON object of headers for connecting. Only Sec-WebSocket-Protocol reaches the server yet, since browsers can't send others such as Authorization. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Connection**<br>`connection` | `connection` | A handle to this connection. Wire it into WebSocket Send and WebSocket Receive. |
| **Connected**<br>`connected` | `boolean` | True while the connection is open and messages can travel. |
| **Connecting**<br>`connecting` | `boolean` | True while the connection is being set up. |
| **Error**<br>`error` | `boolean` | True when the latest attempt to connect or send had a problem. |
| **Error Message**<br>`errorMessage` | `text` | A plain-language description of the latest problem, or empty text when there's none. |

## Examples

### Show a live status dot and the latest message

```text
layer status_dot oval "Status Dot" @24,72 12x12 opacity←live.connected
layer last_message text "Last Message" @24,120 text←inbox.message
patch live webSocketConnection connect=true url="wss://example.com/live"
patch inbox webSocketReceive<text> connection←live.connection
```

### Tap to go online or offline

```text
layer online_button rectangle "Online Button" @16,760 358x56
patch tap_online interaction layer=@online_button
patch online switch flip←tap_online.tap
patch live webSocketConnection connect←online.on url="wss://example.com/live"
```

## Common mistakes

- Connected never turns on in the web player: the URL uses ws:// from a secure page, or the server needs a header Sonobe can't send yet. Use wss:// and put tokens in the URL.
- The connection drops and never comes back: it doesn't retry by itself. Turn Connect off and on again, for example with a Switch.

## Pairs well with

- [WebSocket Send](webSocketSend.md): Sends a text or JSON message over a WebSocket connection when it gets a pulse.
- [WebSocket Receive](webSocketReceive.md): Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.

## Availability

**Web-limited.** Browsers can't set WebSocket headers and block ws:// from https pages, so no host sends Headers yet (only Sec-WebSocket-Protocol) and the web player needs wss://.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** WebSocket Connection (`builtin.websocket.connect`)
- **Also imports:** `builtin.webSocket.connect`

| Sonobe port | Origami label |
|---|---|
| `errorMessage` | Error |
