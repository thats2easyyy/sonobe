<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Base64 Decode

Turns base64 text back into text, JSON, an image, or a sound.

| | |
|---|---|
| Type key | `base64Decode` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | decode, base64, atob, data url, decode image, text to image, unencode |

## How it works
Base64 Decode turns base64 text (letters, digits, and a few symbols that stand in for data) back into the original text, JSON, image, or sound. APIs often send small images or payloads this way inside JSON.

- **Base64** is the text to decode. A `data:…;base64,` prefix, line breaks, and the URL-safe `-` and `_` characters are all fine.
- Right-click to choose what **Output** is: Text, JSON, Image, or Sound.
- **Loading** is true while a very large payload is still being decoded.
- **Error** and **Error Message** explain what went wrong, such as text that isn't base64 or data that isn't an image.
- **Queue** (advanced) decodes every value in order instead of skipping to the newest one.

## Tips
- Connect an Image Output straight to an Image layer's Image property.
- Pull the base64 field out of a JSON response with Value for Key before decoding it.
- If a JSON decode fails, switch to Text to see what the data really contains.

## Coming from Origami
This patch was called Decode. Its Text input is named **Base64**. Error and Error Message are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Base64**<br>`base64` | `text` | `""` | The base64 text to decode. A data: prefix, line breaks, and URL-safe characters are accepted. |
| **Queue**<br>`queue` | `boolean` · advanced | `false` | When on, every new value is decoded in order. When off, a new value replaces one that's still decoding. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The decoded text, JSON, image, or sound, depending on the patch's type. It's empty (or null) when decoding fails. |
| **Loading**<br>`loading` | `boolean` | True while a very large value is still being decoded. |
| **Error**<br>`error` | `boolean` | True when the text isn't valid base64 or doesn't decode to the patch's type. |
| **Error Message**<br>`errorMessage` | `text` | A plain-language reason decoding failed, or empty text when it worked. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `text` (default), `json`, `image`, `sound`.

## Examples

### Read a base64 message from a server

```text
layer message_label text "Message" @24,160 text←decode_message.output
patch on_start whenPrototypeStarts
patch fetch_message networkRequest<text> request←on_start.started url="https://example.com/message.b64"
patch decode_message base64Decode<text> base64←fetch_message.result
```

### Show a tiny embedded icon

The base64 text is a 1x1 PNG image.

```text
layer badge_icon image "Badge Icon" @24,72 24x24 image←decode_icon.output
patch decode_icon base64Decode<image> base64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
```

## Common mistakes

- Error Message says the text isn't valid base64: extra characters came along, such as quotes, a label, or a whole JSON object. Pass only the base64 field, for example through Value for Key.
- The image never appears: the patch is still set to Text or JSON. Right-click it and choose Image.
- JSON Output is null with an error: the data decodes to text that isn't JSON. Switch the patch to Text to see what's inside.

## Pairs well with

- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Base64 Encode](base64Encode.md): Turns text, JSON, an image, or a sound into base64 text for sending inside requests, links, or JSON.
- [WebSocket Receive](webSocketReceive.md): Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Decode (`builtin.data.base64.decode`)

| Sonobe port | Origami label |
|---|---|
| `base64` | Text |
