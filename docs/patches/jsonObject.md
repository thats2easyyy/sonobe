<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JSON Object

Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.

| | |
|---|---|
| Type key | `jsonObject` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | make object, dictionary, key value, create json, map, record, headers, request body |

## How it works
A JSON object stores values by name. This patch makes an object with exactly one entry.

- **Key** is the entry's name. Capital letters and spaces count.
- **Value** is what the key holds. Change the patch's type to store text, numbers, booleans, colors, points, JSON, or media.
- **Object** is the result, updated on the same frame Key or Value changes. When Key is empty, Object is `{}`.

Colors become `"#RRGGBBAA"` text and points become `[x, y]` lists, so the data reads cleanly as text.

## Tips
- Add more entries with Set Value for Key, or merge several objects with Object Join.
- Set the type to JSON to nest another object or an array inside this one.
- Build request headers such as `Authorization` with a Text value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Key**<br>`key` | `text` | `"key"` | The entry's name, used exactly as typed; empty text gives an empty object. |
| **Value**<br>`value` | `variant` | `0` | The value stored under Key. Its type follows the patch's type. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Object**<br>`object` | `json` | A JSON object with one entry: Key set to Value. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `json`, `image`, `video`, `sound`.

## Examples

### Send a message as a request body

```text
layer send_button rectangle "Send" @24,760 342x52
patch tap_send interaction layer=@send_button
patch message jsonObject<text> key="text" value="Running 5 minutes late"
patch with_room setValueForKey<number> object←message.object key="roomId" value=42
patch post networkRequest request←tap_send.tap url="https://example.com/messages" body←with_room.output
```

### Show a toggle's state as JSON

```text
layer bell rectangle "Bell" @171,300 48x48
layer state_label text "State" @24,400 text←state_text.text
patch tap_bell interaction layer=@bell
patch muted switch flip←tap_bell.tap
patch state jsonObject<boolean> key="muted" value←muted.on
patch state_text jsonToText json←state.object pretty=false
```

## Common mistakes

- The object only ever has one entry: JSON Object holds a single key. Chain Set Value for Key after it, or join several objects with Object Join.
- The server ignores the value: keys are case-sensitive and exact, so "userId" isn't "userid ". Match the key the API expects character for character.
- A number arrives as text, or the other way around: the patch type decides how Value is stored. Set the type to Number for 42 and to Text for "42".

## Pairs well with

- [Set Value for Key](setValueForKey.md): Adds or replaces one named field in a JSON object and outputs the updated copy.
- [Object Join](objectJoin.md): Merges several JSON objects into one, with later objects overwriting keys that earlier ones already have.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [JSON to Text](jsonToText.md): Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** JSON Object (`builtin.structure.object`)
