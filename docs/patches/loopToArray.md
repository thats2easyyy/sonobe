<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop to Array

Packs a whole loop into one JSON array you can send, store, or inspect.

| | |
|---|---|
| Type key | `loopToArray` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | loop to json, to array, pack loop, collect, gather, serialize loop |

## How it works
Loop to Array packs every item of a loop, in order, into one JSON array. Downstream patches then see a single value instead of repeating once per item. That's what request bodies, scripts, variables, and data patches expect.

- **Loop** is the loop to pack. It accepts a loop of any type, and a single value becomes a one-item array.
- **Array** is the JSON array. An empty loop gives `[]`.

Items are written the way Sonobe documents store values: numbers, text, and true/false as themselves, colors as `"#RRGGBBAA"` text, and points and sizes as number arrays like `[x, y]`.

## Tips
- Send a list to a server: wire Array into Network Request's Body.
- Read one item by position with Value at Index, or count items with Array Count.
- Loop Over Array turns the array back into a loop. Colors and points convert back when you wire the items into a color or point port.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `any` · whole loop | empty loop | The loop to pack, of any type. A single value becomes a one-item array. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Array**<br>`array` | `json` | One JSON array holding every item in order; [] for an empty loop. |

## Examples

### Send the cart to a server

```text
layer add_button rectangle "Add" @16,720 358x52
layer checkout_button rectangle "Checkout" @16,780 358x52
patch tap_add interaction layer=@add_button
patch tap_checkout interaction layer=@checkout_button
patch cart loopAppend<text> value="sku_42" append←tap_add.tap
patch cart_json loopToArray loop←cart.output
patch checkout networkRequest url="https://example.com/api/checkout" body←cart_json.array request←tap_checkout.tap
```

### Inspect a loop as JSON

Watch shows the array, such as ["#34C759FF", "#FF3B30FF", "#007AFFFF"], in the console.

```text
patch palette loopShuffle<color> loop=loop[#FF3B30FF|#34C759FF|#007AFFFF]
patch palette_json loopToArray loop←palette.output
patch peek watch value←palette_json.array
```

## Common mistakes

- The request fires once per item: the loop itself is wired into Network Request. Pack it with Loop to Array first so the body is one JSON value.
- A script receives colors as text like "#FF3B30FF": colors are written as hex text and points as [x, y] arrays. Parse them in the script, or send the array through Loop Over Array into a typed port to convert back.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [JSON to Text](jsonToText.md): Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop to Array (`builtin.loop.toarray`)
- **Also imports:** `builtin.loop.toArray`
