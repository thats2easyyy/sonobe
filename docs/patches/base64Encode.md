<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Base64 Encode

Turns text, JSON, an image, or a sound into base64 text for sending inside requests, links, or JSON.

| | |
|---|---|
| Type key | `base64Encode` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | encode, base64, btoa, data url, encode image, basic auth, binary to text |

## How it works
Base64 Encode turns data into base64: plain text made only of letters, digits, and a few symbols, so it can travel safely inside JSON, URLs, and request headers.

- Right-click to choose what **Value** is: Text, JSON, Image, or Sound.
- **Base64** is the encoded text. It updates whenever Value changes.
- **Loading** is true while a large image or sound is still being read and encoded.
- **URL Safe** (advanced) swaps `+` and `/` for `-` and `_` and drops the `=` padding, so the result can sit inside a link.
- **Queue** (advanced) encodes every value in order instead of skipping to the newest one when values change faster than encoding finishes.

## Tips
- Some APIs want images uploaded as base64 inside a JSON body. Encode the image, then put Base64 into the request's Body.
- Basic authentication headers use `Basic ` followed by the base64 of `username:password`.
- Base64 is about a third larger than the original data, and anyone can decode it. It isn't encryption.

## Coming from Origami
This patch was called Encode. Its Text output is named **Base64**, and URL Safe, Error, and Error Message are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `""` | The text, JSON, image, or sound to encode, depending on the patch's type. |
| **URL Safe**<br>`urlSafe` | `boolean` · advanced | `false` | When on, uses - and _ instead of + and / and removes = padding, so the result can go inside a URL. |
| **Queue**<br>`queue` | `boolean` · advanced | `false` | When on, every new value is encoded in order. When off, a new value replaces one that's still encoding. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Base64**<br>`base64` | `text` | The encoded base64 text, without line breaks or a data: prefix. It keeps the previous result while new work is loading. |
| **Loading**<br>`loading` | `boolean` | True while a large value or a media file is still being encoded. |
| **Error**<br>`error` | `boolean` · advanced | True when the image or sound couldn't be read. |
| **Error Message**<br>`errorMessage` | `text` · advanced | A plain-language reason encoding failed, or empty text when it worked. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `text` (default), `json`, `image`, `sound`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `json` | `value` | `{}` |

## Examples

### Share a game state in a link

URL Safe keeps the encoded state readable inside the link.

```text
layer share_button rectangle "Share Button" @16,760 358x56
patch encode_state base64Encode<text> value="level=3;score=1200" urlSafe=true
patch share_link add<text>[2] value1="https://example.com/play?s=" value2←encode_state.base64
patch tap_share interaction layer=@share_button
patch open_share openUrl open←tap_share.tap url←share_link.output
```

### Show what text looks like in base64

```text
layer encoded_label text "Encoded" @24,160 text←encode_greeting.base64
patch encode_greeting base64Encode<text> value="hello-world"
```

## Common mistakes

- The server rejects a Basic authentication header: the whole header, including the word Basic, was encoded. Encode only username:password, then join "Basic " in front with Add set to Text.
- The result decodes to text wrapped in quotes: the patch is set to JSON while Value is plain text, so it's encoded as a JSON string. Switch the patch to Text.
- A link with base64 in it breaks: standard base64 uses + and /, which URLs treat specially. Turn on URL Safe.

## Pairs well with

- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Base64 Decode](base64Decode.md): Turns base64 text back into text, JSON, an image, or a sound.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Open URL](openUrl.md): Opens a website, email, phone number, or app link outside the prototype when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Encode (`builtin.data.base64.encode`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
| `base64` | Text |
