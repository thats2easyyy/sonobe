<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JSON to Text

Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.

| | |
|---|---|
| Type key | `jsonToText` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | text from json, structure formatter, stringify, serialize, print json, debug data, format json |

## How it works
JSON to Text writes a JSON value out as text, so you can see what's inside it.

- **JSON** is the value to write out: an object, an array, or a single value.
- **Pretty** puts each entry on its own line, indented by two spaces. Turn it off for compact one-line text, which is better for sending data.
- **Text** is valid JSON text. Text values come out in quotes, and empty data comes out as `null`.

Keys keep the order they have in the object, except that keys made only of digits come first. Colors appear as `"#RRGGBBAA"` text.

## Tips
- Wire a network response into JSON to Text and then into a Text layer to see its structure while you build.
- Text to JSON reads the text back into data.
- Very large responses make long text. Narrow them first with Value for Key or Subarray.

## Coming from Origami
Formerly called Text from JSON. Pretty is a Sonobe addition.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **JSON**<br>`json` | `json` | none | The object, array, or single value to write out as text. |
| **Pretty**<br>`pretty` | `boolean` | `true` | When on, writes one entry per line with 2-space indentation; when off, writes compact one-line text. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Text**<br>`text` | `text` | The value as JSON text. |

## Examples

### Inspect a network response on screen

```text
layer debug_text text "Response" @16,80 358x700 fontSize=12 text←response_text.text
patch launch whenPrototypeStarts
patch profile networkRequest request←launch.started url="https://example.com/profile.json"
patch response_text jsonToText json←profile.result
```

### Show a compact summary of a selection

```text
layer summary text "Summary" @24,120 text←summary_text.text
layer size_button rectangle "Size" @24,760 342x52
patch tap_size interaction layer=@size_button
patch size_step counter increase←tap_size.tap maximumCount=3
patch order jsonObject<number> key="size" value←size_step.count
patch summary_text jsonToText json←order.object pretty=false
```

## Common mistakes

- The Text layer shows `null`: the request hasn't returned yet, or the wire comes from the wrong output. Wait for Loading to turn off, and wire the request's Result.
- Only part of the text fits on screen: pretty printing adds many lines. Turn Pretty off, make the Text layer taller, or narrow the data with Value for Key first.

## Pairs well with

- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Text to JSON](textToJson.md): Reads text written in JSON format and turns it into data the JSON patches can use.
- [JSON Object](jsonObject.md): Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** JSON to Text (`builtin.structure.format`)
- **Also imports:** `builtin.structureformatter`

| Sonobe port | Origami label |
|---|---|
| `json` | Input |
| `text` | Output |
