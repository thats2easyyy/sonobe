<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Open URL

Opens a website, email, phone number, or app link outside the prototype when it gets a pulse.

| | |
|---|---|
| Type key | `openUrl` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | open link, hyperlink, deep link, launch url, open website, href, app link, mailto |

## How it works
Open URL opens a link outside the prototype when **Open** gets a pulse (a signal that's on for one frame), like a "Learn more" button that opens a web page.

- **URL** can be a website (`https://…`), an email (`mailto:…`), a phone number (`tel:…`), or another app's link scheme (`myapp://…`).
- **Opened** pulses when the link opened. **Failed** pulses when it couldn't open, and **Error Message** explains why.

On a computer, websites open in the default browser. On a phone, the link may leave the prototype and open another app.

## Tips
- Wire an Interaction patch's Tap into Open. Browsers only open new tabs right after a tap or key press, so links opened by timers are usually blocked.
- Build links from data with Add set to Text, such as a base address plus an item's id.
- Links using `javascript:`, `file:`, or `data:` are refused to keep shared prototypes safe.

## Coming from Origami
Result is named **Opened**. Failed and Error Message are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Open**<br>`open` | `pulse` | — | Pulse to open the URL. Wire a Tap into it so browsers allow the new tab. |
| **URL**<br>`url` | `text` (url) | `""` | The link to open: https:// for websites, mailto: for email, tel: for phone calls, or an app scheme like myapp://. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Opened**<br>`opened` | `pulse` | Pulses when the link opened. |
| **Failed**<br>`failed` | `pulse` | Pulses when the link couldn't open, for example when the URL is empty, the browser blocked it, or the scheme isn't allowed. |
| **Error Message**<br>`errorMessage` | `text` · advanced | A plain-language reason the last open failed, or empty text after a link opens. |

## Examples

### Tap a link to open the help page

```text
layer help_link text "Help Link" @24,780 text=Help
patch tap_help interaction layer=@help_link
patch open_help openUrl open←tap_help.tap url="https://example.com/help"
```

### Open a product page built from its id

Add set to Text joins the base address and the id.

```text
layer buy_button rectangle "Buy Button" @16,760 358x56
patch product_link add<text>[2] value1="https://example.com/products/" value2="sku-2041"
patch tap_buy interaction layer=@buy_button
patch open_product openUrl open←tap_buy.tap url←product_link.output
```

## Common mistakes

- Nothing opens in the web player: the pulse didn't come from a tap or key press, so the browser blocked the new tab. Trigger Open from an Interaction patch's Tap.
- Failed fires with "Start the URL with https://": the URL has no scheme, like example.com. Add https:// to the front.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Base64 Encode](base64Encode.md): Turns text, JSON, an image, or a sound into base64 text for sending inside requests, links, or JSON.

## Availability

**Web-limited.** Browsers open new tabs only right after a tap or key press, and custom app schemes work only when an app handles them; headless simulation records the URL instead.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Open URL (`builtin.open.url`)

| Sonobe port | Origami label |
|---|---|
| `opened` | Result |
